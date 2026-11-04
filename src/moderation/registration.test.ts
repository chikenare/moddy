import { beforeEach, expect, test, vi } from "vitest";
import type { Chat } from "grammy/types";
import { type Db, openDatabase } from "../db/connection.js";
import { getChat, insertChat, updateChatSettings } from "../db/chats.js";
import { listWords } from "../db/lists.js";
import { createTestBot } from "../test/harness.js";
import { channelPost, editedGroupMessage, groupMessage, myChatMember } from "../test/updates.js";
import { createRegistrationHandler } from "./registration.js";

let db: Db;
let t: ReturnType<typeof createTestBot>;
let nextCalled: boolean;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  db = openDatabase(":memory:");
  t = createTestBot();
  nextCalled = false;
  t.bot.use(createRegistrationHandler({ db }));
  t.bot.use((_ctx, next) => { nextCalled = true; return next(); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const known = (id: number, type: "group" | "supergroup" = "supergroup") =>
  insertChat(db, { id, type, title: "Viejo", username: null }, []);

test("el primer mensaje de un grupo desconocido lo registra apagado y sigue a next()", async () => {
  await t.bot.handleUpdate(groupMessage({ text: "hola" }));
  expect(getChat(db, -100)).toMatchObject({ title: "Grupo", type: "supergroup", moderationEnabled: false });
  expect(listWords(db, -100)).toEqual(expect.arrayContaining(["mierda"]));
  expect(nextCalled).toBe(true);
});

test("un mensaje editado de un grupo desconocido también lo registra", async () => {
  await t.bot.handleUpdate(editedGroupMessage({ text: "hola" }));
  expect(getChat(db, -100)).toBeDefined();
  expect(nextCalled).toBe(true);
});

test("no bloquea el update esperando a getChat", async () => {
  t.respond("getChat", () => new Promise(() => {}));
  await t.bot.handleUpdate(groupMessage({ text: "hola" }));
  expect(getChat(db, -100)).toBeDefined();
  expect(nextCalled).toBe(true);
});

test("guarda linked_chat_id y permisos cuando responde Telegram", async () => {
  t.respond("getChat", (p) => ({ id: p.chat_id, type: "supergroup", title: "Grupo", linked_chat_id: -555 }));
  t.respond("getChatMember", (p) => ({
    status: "administrator", user: { id: p.user_id, is_bot: true, first_name: "Test" },
    can_delete_messages: true, can_restrict_members: false,
  }));
  await t.bot.handleUpdate(groupMessage());
  await flush();
  expect(t.callsOf("getChatMember")[0].payload).toMatchObject({ chat_id: -100, user_id: 999 });
  expect(getChat(db, -100)).toMatchObject({
    linkedChatId: -555, botStatus: "administrator", canDelete: true, canRestrict: false,
  });
});

test("un error al consultar a Telegram solo se registra", async () => {
  t.respond("getChat", () => { throw new Error("boom"); });
  await t.bot.handleUpdate(groupMessage());
  await flush();
  expect(getChat(db, -100)).toBeDefined();
  expect(console.error).toHaveBeenCalled();
});

test("my_chat_member guarda estado y permisos", async () => {
  t.respond("getChatMember", (p) => ({
    status: "administrator", user: { id: p.user_id, is_bot: true, first_name: "Test" },
    can_delete_messages: true, can_restrict_members: true,
  }));
  await t.bot.handleUpdate(myChatMember({ status: "administrator", canDelete: true, canRestrict: true }));
  expect(getChat(db, -100)).toMatchObject({ botStatus: "administrator", canDelete: true, canRestrict: true });
});

test("left marca un chat conocido y no crea uno desconocido", async () => {
  known(-100);
  updateChatSettings(db, -100, { moderationEnabled: true });
  await t.bot.handleUpdate(myChatMember({ status: "left" }));
  expect(getChat(db, -100)).toMatchObject({ botStatus: "left", canDelete: false, canRestrict: false, moderationEnabled: true });

  await t.bot.handleUpdate(myChatMember({ chat: { id: -300, type: "group", title: "Otro" }, status: "kicked" }));
  expect(getChat(db, -300)).toBeUndefined();
});

test("channel_post registra el canal", async () => {
  t.respond("getChat", (p) => ({ id: p.chat_id, type: "channel", title: "Canal" }));
  await t.bot.handleUpdate(channelPost());
  expect(getChat(db, -1002)).toMatchObject({ type: "channel", title: "Canal", moderationEnabled: false });
  expect(nextCalled).toBe(true);
});

test("un chat privado no se registra", async () => {
  const priv: Chat = { id: 10, type: "private", first_name: "Ana" };
  await t.bot.handleUpdate(groupMessage({ chat: priv }));
  await t.bot.handleUpdate(myChatMember({ chat: priv, status: "member" }));
  expect(getChat(db, 10)).toBeUndefined();
  expect(t.callsOf("getChat")).toHaveLength(0);
  expect(nextCalled).toBe(true);
});

test("new_chat_title actualiza el título", async () => {
  known(-100);
  await t.bot.handleUpdate(groupMessage({ text: undefined, new_chat_title: "Nuevo" }));
  expect(getChat(db, -100)?.title).toBe("Nuevo");
});

test("migrate_to_chat_id y migrate_from_chat_id migran en cualquier orden", async () => {
  const group = (id: number): Chat => ({ id, type: id === -1 ? "group" : "supergroup", title: "G" });

  known(-1, "group");
  updateChatSettings(db, -1, { moderationEnabled: true });
  await t.bot.handleUpdate(groupMessage({ chat: group(-1), migrate_to_chat_id: -1001 }));
  await t.bot.handleUpdate(groupMessage({ chat: group(-1001), migrate_from_chat_id: -1 }));
  await flush();
  expect(getChat(db, -1)).toBeUndefined();
  expect(getChat(db, -1001)).toMatchObject({ moderationEnabled: true, type: "supergroup" });

  const other = { from: -2, to: -1002 };
  known(other.from, "group");
  updateChatSettings(db, other.from, { moderationEnabled: true });
  await t.bot.handleUpdate(groupMessage({ chat: group(other.to), text: "hola" }));
  await t.bot.handleUpdate(groupMessage({ chat: group(other.to), migrate_from_chat_id: other.from }));
  await t.bot.handleUpdate(groupMessage({ chat: group(other.from), migrate_to_chat_id: other.to }));
  await flush();
  expect(getChat(db, other.from)).toBeUndefined();
  expect(getChat(db, other.to)).toMatchObject({ moderationEnabled: true });
});

test("un servicio que anuncia la salida del propio bot no registra el chat", async () => {
  await t.bot.handleUpdate(groupMessage({ text: undefined, left_chat_member: { id: 999, is_bot: true, first_name: "Test" } }));
  expect(getChat(db, -100)).toBeUndefined();
  expect(nextCalled).toBe(true);
});

test("la salida de otro usuario sí registra el chat", async () => {
  await t.bot.handleUpdate(groupMessage({ text: undefined, left_chat_member: { id: 55, is_bot: false, first_name: "Luis" } }));
  expect(getChat(db, -100)).toBeDefined();
});

test("si getChat falla, el resultado de getChatMember se guarda igual", async () => {
  t.respond("getChat", () => { throw new Error("boom"); });
  t.respond("getChatMember", (p) => ({
    status: "administrator", user: { id: p.user_id, is_bot: true, first_name: "Test" },
    can_delete_messages: true, can_restrict_members: true,
  }));
  await t.bot.handleUpdate(groupMessage());
  await flush();
  expect(getChat(db, -100)).toMatchObject({ botStatus: "administrator", canDelete: true, canRestrict: true, linkedChatId: null });
  expect(console.error).toHaveBeenCalled();
});

test("si getChatMember falla, el resultado de getChat se guarda igual", async () => {
  t.respond("getChat", (p) => ({ id: p.chat_id, type: "supergroup", title: "Grupo", linked_chat_id: -555 }));
  t.respond("getChatMember", () => { throw new Error("boom"); });
  await t.bot.handleUpdate(groupMessage());
  await flush();
  expect(getChat(db, -100)).toMatchObject({ linkedChatId: -555, botStatus: "unknown" });
  expect(console.error).toHaveBeenCalled();
});

test("el refresco guarda tipo, título y username de getChat", async () => {
  known(-100, "group");
  t.respond("getChat", (p) => ({ id: p.chat_id, type: "supergroup", title: "Nuevo título", username: "migrupo" }));
  await t.bot.handleUpdate(myChatMember({ status: "member" }));
  await flush();
  expect(getChat(db, -100)).toMatchObject({ type: "supergroup", title: "Nuevo título", username: "migrupo" });
});

test("my_chat_member administrator o member de un chat conocido refresca; left y kicked no", async () => {
  known(-100);
  await t.bot.handleUpdate(myChatMember({ status: "administrator" }));
  await flush();
  expect(t.callsOf("getChat")).toHaveLength(1);
  await t.bot.handleUpdate(myChatMember({ status: "member" }));
  await flush();
  expect(t.callsOf("getChat")).toHaveLength(2);
  await t.bot.handleUpdate(myChatMember({ status: "left" }));
  await t.bot.handleUpdate(myChatMember({ status: "kicked" }));
  await flush();
  expect(t.callsOf("getChat")).toHaveLength(2);
});

test("my_chat_member de un chat desconocido refresca una sola vez", async () => {
  await t.bot.handleUpdate(myChatMember({ status: "member" }));
  await flush();
  expect(t.callsOf("getChat")).toHaveLength(1);
});

test("si la escritura del refresco falla, se registra y no hay rechazo sin manejar", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  t.respond("getChatMember", (p) => {
    db.close();
    return { status: "member", user: { id: p.user_id, is_bot: true, first_name: "Test" } };
  });
  await t.bot.handleUpdate(groupMessage()).catch(() => {});
  await flush();
  await flush();
  process.off("unhandledRejection", onUnhandled);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No se pudo guardar"), expect.anything());
  expect(unhandled).toEqual([]);
});
