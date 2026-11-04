import { beforeEach, expect, test, vi } from "vitest";
import type { Chat } from "grammy/types";
import { type Db, openDatabase } from "../db/connection.js";
import { insertChat, updateChatInfo, updateChatSettings } from "../db/chats.js";
import { listEvents } from "../db/events.js";
import { addWhitelistEntry, addWord } from "../db/lists.js";
import { createTestBot } from "../test/harness.js";
import { channelPost, editedGroupMessage, groupMessage } from "../test/updates.js";
import { createEnforcer } from "./enforcer.js";
import { FloodTracker } from "./flood.js";
import { createModerationHandler } from "./handler.js";
import { createRegistrationHandler } from "./registration.js";

let db: Db;
let t: ReturnType<typeof createTestBot>;
let enforcer: ReturnType<typeof createEnforcer>;
let flood: FloodTracker;
let nextCalled: boolean;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: -100, type: "supergroup", title: "Grupo", username: null }, []);
  updateChatSettings(db, -100, { moderationEnabled: true });
  t = createTestBot();
  enforcer = createEnforcer({ api: t.bot.api, db, appEnv: "production" });
  flood = new FloodTracker();
  nextCalled = false;
  t.bot.use(createRegistrationHandler({ db }));
  t.bot.use(createModerationHandler({ db, enforcer, flood }));
  t.bot.use((_ctx, next) => { nextCalled = true; return next(); });
  t.bot.command("start", (ctx) => ctx.reply("hola"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const LINK = { text: "a.example", entities: [{ type: "url" as const, offset: 0, length: 9 }] };
const events = () => listEvents(db, -100, { limit: 50 });
const run = async (...updates: Parameters<typeof t.bot.handleUpdate>[0][]) => {
  for (const u of updates) await t.bot.handleUpdate(u);
  await enforcer.drain();
};
const expectNoAction = () => {
  expect(t.callsOf("deleteMessages")).toHaveLength(0);
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(t.callsOf("banChatSenderChat")).toHaveLength(0);
  expect(events()).toHaveLength(0);
};

test("chat apagado: ni llamadas a Telegram ni eventos ni texto guardado", async () => {
  updateChatSettings(db, -100, { moderationEnabled: false });
  const spy = vi.spyOn(flood, "record");
  await run(groupMessage(LINK));
  expect(t.calls).toHaveLength(0);
  expect(events()).toHaveLength(0);
  expect(spy).not.toHaveBeenCalled();
  expect(nextCalled).toBe(true);
});

test("enlace no autorizado: borra, banea, registra y no sigue a next()", async () => {
  await run(groupMessage(LINK));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(t.callsOf("banChatMember")[0]!.payload).toMatchObject({ chat_id: -100, user_id: 10 });
  expect(events()[0]).toMatchObject({ filter: "link", matched: "a.example", text: "a.example" });
  expect(nextCalled).toBe(false);
});

test("/start con enlace se modera y no se responde", async () => {
  await run(groupMessage({
    text: "/start a.example",
    entities: [{ type: "bot_command", offset: 0, length: 6 }, { type: "url", offset: 7, length: 9 }],
  }));
  expect(t.callsOf("sendMessage")).toHaveLength(0);
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
});

test("una edición que agrega un enlace se detecta", async () => {
  await run(editedGroupMessage(LINK));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(events()[0]).toMatchObject({ filter: "link" });
});

test("enlace en la lista blanca sigue a next()", async () => {
  addWhitelistEntry(db, -100, "a.example");
  await run(groupMessage(LINK));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test("palabra en el pie de una foto se detecta", async () => {
  addWord(db, -100, "estafa");
  await run(groupMessage({
    text: undefined, caption: "gran estafa aquí",
    photo: [{ file_id: "f", file_unique_id: "u1", width: 1, height: 1 }],
  }));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(events()[0]).toMatchObject({ filter: "word", matched: "estafa", text: "gran estafa aquí" });
});

test("cinco mensajes iguales en 10 s borran los cinco", async () => {
  const msgs = [1, 2, 3, 4, 5].map((i) => groupMessage({ message_id: 500 + i, text: "compra ya" }));
  await run(...msgs);
  const calls = t.callsOf("deleteMessages");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.payload.message_ids).toEqual([501, 502, 503, 504, 505]);
  expect(events()[0]).toMatchObject({ filter: "flood" });
});

test("mensajes atrasados no son flood; las ediciones no cuentan", async () => {
  const slow = [0, 1, 2, 3, 4].map((i) => groupMessage({ text: "compra ya", date: 1_000_000 + i * 20 }));
  await run(...slow);
  expectNoAction();

  const fresh = [0, 1, 2, 3].map(() => groupMessage({ text: "oferta única", date: 2_000_000 }));
  await run(...fresh, editedGroupMessage({ text: "oferta única", date: 2_000_000 }));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test.each([
  ["reenvío automático", { is_automatic_forward: true as const, sender_chat: { id: -555, type: "channel" as const, title: "C" } }, undefined],
  ["admin anónimo", { sender_chat: { id: -100, type: "supergroup" as const, title: "Grupo" }, from: undefined }, undefined],
  ["canal vinculado", { sender_chat: { id: -777, type: "channel" as const, title: "Vinc" } }, -777],
])("%s no recibe acción", async (_name, overrides, linked) => {
  if (linked) updateChatInfo(db, -100, { linkedChatId: linked });
  await run(groupMessage({ ...LINK, ...overrides } as any));
  expectNoAction();
  expect(t.callsOf("getChatMember")).toHaveLength(0);
  expect(nextCalled).toBe(true);
});

test("admin confirmado no recibe acción ni evento", async () => {
  t.respond("getChatMember", (p) => ({ status: "administrator", user: { id: p.user_id, is_bot: false, first_name: "Ana" } }));
  await run(groupMessage(LINK));
  expect(t.callsOf("getChatMember").some((c) => c.payload.user_id === 10)).toBe(true);
  expectNoAction();
});

test("mensaje como otro canal usa banChatSenderChat", async () => {
  const other: Chat = { id: -888, type: "channel", title: "Otro" };
  await run(groupMessage({ ...LINK, from: undefined, sender_chat: other } as any));
  expect(t.callsOf("banChatSenderChat")[0]!.payload).toMatchObject({ chat_id: -100, sender_chat_id: -888 });
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(t.callsOf("getChatMember")).toHaveLength(0);
  expect(events()[0]).toMatchObject({ senderType: "chat", senderId: -888 });
});

test("filtro apagado no actúa; acción delete no banea", async () => {
  updateChatSettings(db, -100, { linkFilterEnabled: false });
  await run(groupMessage(LINK));
  expectNoAction();
  expect(nextCalled).toBe(true);

  updateChatSettings(db, -100, { linkFilterEnabled: true, linkFilterAction: "delete" });
  await run(groupMessage(LINK));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(events()[0]).toMatchObject({ filter: "link", action: "delete", banOk: null });
});

const botAdded = (members: unknown[]) =>
  groupMessage({ message_id: 700, text: undefined, new_chat_members: members } as any);

test("un no admin agrega un bot: se banea al bot y se borra el aviso", async () => {
  await run(botAdded([{ id: 50, is_bot: true, first_name: "Spam", username: "spam_bot" }]));
  expect(t.callsOf("banChatMember")[0]!.payload).toMatchObject({ chat_id: -100, user_id: 50 });
  expect(t.callsOf("deleteMessages")[0]!.payload.message_ids).toEqual([700]);
  expect(t.callsOf("getChatMember").some((c) => c.payload.user_id === 10)).toBe(true);
  expect(events()[0]).toMatchObject({ filter: "bot", senderId: 50, matched: "@spam_bot", text: null });
  expect(nextCalled).toBe(false);
});

test("un admin agrega un bot: no se hace nada", async () => {
  t.respond("getChatMember", (p) => ({ status: "administrator", user: { id: p.user_id, is_bot: false, first_name: "Ana" } }));
  await run(botAdded([{ id: 50, is_bot: true, first_name: "Spam" }]));
  expectNoAction();
});

test("agregar nuestro propio bot o a una persona no activa el filtro", async () => {
  await run(botAdded([{ id: 999, is_bot: true, first_name: "Test" }]), botAdded([{ id: 11, is_bot: false, first_name: "Luis" }]));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test("chats privados y canales nunca se evalúan", async () => {
  const priv: Chat = { id: 10, type: "private", first_name: "Ana" };
  await run(groupMessage({ ...LINK, chat: priv }), channelPost(LINK));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

const noSenderApiCalls = () => {
  expect(t.callsOf("deleteMessages")).toHaveLength(0);
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(t.callsOf("banChatSenderChat")).toHaveLength(0);
  expect(t.callsOf("getChatMember").filter((c) => c.payload.user_id !== 999)).toHaveLength(0);
};
const same = (n: number, extra: object = {}) =>
  Array.from({ length: n }, (_, i) => groupMessage({ message_id: 900 + i, text: "compra ya", ...extra } as any));

test("interruptor del filtro de bots apagado: no hace nada", async () => {
  updateChatSettings(db, -100, { botFilterEnabled: false });
  await run(botAdded([{ id: 50, is_bot: true, first_name: "Spam" }]));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test("interruptor del filtro de palabras apagado: no hace nada", async () => {
  addWord(db, -100, "estafa");
  updateChatSettings(db, -100, { wordFilterEnabled: false });
  await run(groupMessage({ text: "gran estafa" }));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test("interruptor del filtro de flood apagado: no hace nada", async () => {
  updateChatSettings(db, -100, { floodFilterEnabled: false });
  await run(...same(5));
  expectNoAction();
  expect(nextCalled).toBe(true);
});

test("palabra con acción delete borra pero no banea, aunque el enlace banee", async () => {
  addWord(db, -100, "estafa");
  updateChatSettings(db, -100, { wordFilterAction: "delete", linkFilterAction: "delete_ban" });
  await run(groupMessage({ text: "gran estafa" }));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(events()[0]).toMatchObject({ filter: "word", action: "delete", banOk: null });
});

test("flood con acción delete borra pero no banea, aunque el enlace banee", async () => {
  updateChatSettings(db, -100, { floodFilterAction: "delete", linkFilterAction: "delete_ban" });
  await run(...same(5));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(t.callsOf("banChatMember")).toHaveLength(0);
  expect(events()[0]).toMatchObject({ filter: "flood", action: "delete", banOk: null });
});

test("el flood de un sender_chat se agrupa por canal, no por from", async () => {
  const ch = (id: number) => ({ id, type: "channel" as const, title: `C${id}` });
  await run(...same(3, { sender_chat: ch(-801) }), ...same(3, { sender_chat: ch(-802) }));
  expectNoAction();
  await run(...same(5, { sender_chat: ch(-803) }));
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(events()[0]).toMatchObject({ filter: "flood", senderType: "chat", senderId: -803 });
});

test("un mensaje limpio o en la lista blanca no hace llamadas al remitente", async () => {
  await run(groupMessage({ text: "hola a todos" }));
  noSenderApiCalls();
  addWhitelistEntry(db, -100, "a.example");
  await run(groupMessage(LINK));
  noSenderApiCalls();
  expect(events()).toHaveLength(0);
});

test("una mención con una palabra prohibida no activa el filtro; el texto normal sí", async () => {
  addWord(db, -100, "mierda");
  await run(groupMessage({ text: "@mierda_king dijo", entities: [{ type: "mention", offset: 0, length: 12 }] }));
  expectNoAction();
  await run(groupMessage({ text: "qué mierda @ana", entities: [{ type: "mention", offset: 11, length: 4 }] }));
  expect(events()[0]).toMatchObject({ filter: "word", matched: "mierda", text: "qué mierda @ana" });
});

test("el pie de foto también enmascara menciones", async () => {
  addWord(db, -100, "mierda");
  const photo = [{ file_id: "f", file_unique_id: "u1", width: 1, height: 1 }];
  await run(groupMessage({ text: undefined, caption: "@mierda_king", caption_entities: [{ type: "mention", offset: 0, length: 12 }], photo }));
  expectNoAction();
});
