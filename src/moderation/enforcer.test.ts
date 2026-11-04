import { GrammyError } from "grammy";
import { beforeEach, expect, test, vi } from "vitest";
import { getChat, insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { listEvents } from "../db/events.js";
import type { AppEnv } from "../env.js";
import { type EnforcerApi, type Violation, createEnforcer } from "./enforcer.js";

let db: Db;
let clock = 0;
beforeEach(() => {
  clock = 1_000_000;
  db = openDatabase(":memory:");
  for (const id of [1, 2]) insertChat(db, { id, type: "group", title: "A", username: null }, []);
});

const viol = (o: Partial<Violation> = {}): Violation => ({
  chatId: 1, sender: { type: "user", id: 10, name: "Ana" }, filter: "link", matched: "x.com", text: "hola",
  action: "delete_ban", messageIds: [7], adminCheckUserId: 10, noticeTemplate: null, ...o,
});

function setup(appEnv: AppEnv = "production", over: Partial<Record<keyof EnforcerApi, unknown>> = {}) {
  const api = {
    getChat: vi.fn(async () => ({ id: 1, type: "supergroup", title: "A" })),
    getChatMember: vi.fn(async () => ({ status: "member" })),
    deleteMessages: vi.fn(async () => true),
    banChatMember: vi.fn(async () => true),
    banChatSenderChat: vi.fn(async () => true),
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    ...over,
  };
  const sleep = vi.fn(async () => {});
  const e = createEnforcer({ api: api as unknown as EnforcerApi, db, appEnv, sleep, now: () => clock });
  return { api, sleep, e };
}
const events = (chat = 1) => listEvents(db, chat, { limit: 10 });
const tooMany = () => new GrammyError("x", { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } }, "deleteMessages", {});

const serverError = () => new GrammyError("x", { ok: false, error_code: 500, description: "Internal", parameters: {} }, "deleteMessages", {});

const NOTICE = "User {user} {action}: {reason}.";
const sentText = (api: { sendMessage: unknown }) => (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]![1];

test("aviso: tras banear se publica en silencio y sin vista previa", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(api.sendMessage).toHaveBeenCalledWith(1, "User Ana banned: unauthorized link.", {
    disable_notification: true,
    link_preview_options: { is_disabled: true },
  });
});

test("aviso: nunca revela la palabra que coincidió", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ filter: "word", matched: "secreta", noticeTemplate: NOTICE }));
  await e.drain();
  expect(sentText(api)).toBe("User Ana banned: banned word.");
});

test("aviso: solo borrar dice advertido", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ action: "delete", noticeTemplate: NOTICE }));
  await e.drain();
  expect(sentText(api)).toBe("User Ana warned: unauthorized link.");
});

test("aviso: en development el ban se presenta como simulado", async () => {
  const { api, e } = setup("development");
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(sentText(api)).toBe("User Ana banned (simulated): unauthorized link.");
});

test("aviso: si el ban falla pero se borró, no dice baneado", async () => {
  const { api, e } = setup("production", { banChatMember: vi.fn(async () => { throw serverError(); }) });
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(sentText(api)).toBe("User Ana warned: unauthorized link.");
});

test("aviso: sin plantilla no se envía nada", async () => {
  const { api, e } = setup();
  e.enqueue(viol());
  await e.drain();
  expect(api.sendMessage).not.toHaveBeenCalled();
});

test("aviso: un admin exento no genera aviso", async () => {
  const { api, e } = setup("production", { getChatMember: vi.fn(async () => ({ status: "administrator" })) });
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(api.sendMessage).not.toHaveBeenCalled();
});

test("aviso: si falla la comprobación de admin no se envía", async () => {
  const { api, e } = setup("production", { getChatMember: vi.fn(async () => { throw serverError(); }) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(api.sendMessage).not.toHaveBeenCalled();
});

test("aviso: el canal vinculado no genera aviso", async () => {
  const { api, e } = setup("production", { getChat: vi.fn(async () => ({ id: 1, type: "supergroup", title: "A", linked_chat_id: -5 })) });
  e.enqueue(viol({ sender: { type: "chat", id: -5, name: "Canal" }, adminCheckUserId: null, noticeTemplate: NOTICE }));
  await e.drain();
  expect(api.sendMessage).not.toHaveBeenCalled();
});

test("aviso: si no se pudo borrar ni banear no se envía", async () => {
  const { api, e } = setup("production", {
    deleteMessages: vi.fn(async () => { throw serverError(); }),
    banChatMember: vi.fn(async () => { throw serverError(); }),
  });
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  await e.drain();
  expect(api.sendMessage).not.toHaveBeenCalled();
});

test("aviso: como máximo uno cada 10 s por chat; las acciones siguen", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  e.enqueue(viol({ noticeTemplate: NOTICE, messageIds: [8] }));
  e.enqueue(viol({ chatId: 2, noticeTemplate: NOTICE, messageIds: [9] }));
  await e.drain();
  expect(api.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [8]);
  expect(events()).toHaveLength(2);
  clock += 9_999;
  e.enqueue(viol({ noticeTemplate: NOTICE, messageIds: [10] }));
  await e.drain();
  expect(api.sendMessage).toHaveBeenCalledTimes(2);
  clock += 1;
  e.enqueue(viol({ noticeTemplate: NOTICE, messageIds: [11] }));
  await e.drain();
  expect(api.sendMessage).toHaveBeenCalledTimes(3);
});

test("aviso: si falla el envío no se reintenta, se registra y la cola sigue", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { api, sleep, e } = setup("production", { sendMessage: vi.fn(async () => { throw tooMany(); }) });
  e.enqueue(viol({ noticeTemplate: NOTICE }));
  e.enqueue(viol({ messageIds: [8] }));
  await e.drain();
  expect(api.sendMessage).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(spy).toHaveBeenCalled();
  expect(events()).toHaveLength(2);
  expect(events()[1]).toMatchObject({ deleteOk: true, banOk: true, error: null });
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [8]);
});

test("production: miembro normal se borra, se banea sin until_date y se registra", async () => {
  const { api, e } = setup();
  e.enqueue(viol());
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [7]);
  expect(api.banChatMember).toHaveBeenCalledWith(1, 10);
  expect(events()[0]).toMatchObject({ deleteOk: true, banOk: true, dryRun: false, error: null });
});

test.each(["creator", "administrator"])("production: %s no recibe acción ni evento", async (status) => {
  const { api, e } = setup("production", { getChatMember: vi.fn(async () => ({ status })) });
  e.enqueue(viol());
  await e.drain();
  expect(api.deleteMessages).not.toHaveBeenCalled();
  expect(api.banChatMember).not.toHaveBeenCalled();
  expect(events()).toHaveLength(0);
});

test("si getChatMember falla no borra ni banea, y registra el error", async () => {
  const { api, e } = setup("production", { getChatMember: vi.fn(async () => { throw new Error("boom"); }) });
  e.enqueue(viol());
  await e.drain();
  expect(api.deleteMessages).not.toHaveBeenCalled();
  expect(api.banChatMember).not.toHaveBeenCalled();
  expect(events()[0]).toMatchObject({ deleteOk: null, banOk: null });
  expect(events()[0]!.error).toContain("boom");
});

test("acción delete no banea", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ action: "delete" }));
  await e.drain();
  expect(api.banChatMember).not.toHaveBeenCalled();
  expect(events()[0]).toMatchObject({ deleteOk: true, banOk: null, dryRun: false });
});

test("remitente canal: usa banChatSenderChat y no consulta getChatMember", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ sender: { type: "chat", id: -300, name: "Canal" }, adminCheckUserId: null }));
  await e.drain();
  expect(api.getChatMember).not.toHaveBeenCalled();
  expect(api.banChatSenderChat).toHaveBeenCalledWith(1, -300);
  expect(api.banChatMember).not.toHaveBeenCalled();
  expect(events()[0]).toMatchObject({ senderType: "chat", banOk: true });
});

test("development: borra, nunca banea ni consulta admin; evento simulado", async () => {
  const { api, e } = setup("development");
  e.enqueue(viol());
  await e.drain();
  expect(api.getChatMember).not.toHaveBeenCalled();
  expect(api.banChatMember).not.toHaveBeenCalled();
  expect(api.banChatSenderChat).not.toHaveBeenCalled();
  expect(events()[0]).toMatchObject({ dryRun: true, banOk: null, deleteOk: true });
});

test("si el ban falla guarda el error y procesa el siguiente del mismo chat", async () => {
  const { api, e } = setup("production", { banChatMember: vi.fn(async () => { throw new Error("sin permiso"); }) });
  e.enqueue(viol());
  e.enqueue(viol({ messageIds: [8] }));
  await e.drain();
  expect(events()[1]).toMatchObject({ banOk: false });
  expect(events()[1]!.error).toContain("sin permiso");
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [8]);
  expect(events()).toHaveLength(2);
});

test("divide el borrado en lotes de 100", async () => {
  const { api, e } = setup();
  e.enqueue(viol({ messageIds: Array.from({ length: 101 }, (_, i) => i + 1) }));
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledTimes(2);
  const calls = (api.deleteMessages as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
  expect(calls[0]![1]).toHaveLength(100);
  expect(calls[1]![1]).toHaveLength(1);
});

test("en 429 espera retry_after y reintenta", async () => {
  let n = 0;
  const { api, sleep, e } = setup("production", { deleteMessages: vi.fn(async () => { if (n++ === 0) throw tooMany(); return true; }) });
  e.enqueue(viol());
  await e.drain();
  expect(sleep).toHaveBeenCalledWith(3000);
  expect(api.deleteMessages).toHaveBeenCalledTimes(2);
  expect(events()[0]).toMatchObject({ deleteOk: true, error: null });
});

test("un chat esperando no retrasa a otro; el mismo chat mantiene el orden", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { e } = setup("production", {
    deleteMessages: vi.fn(async (chat: number, ids: number[]) => {
      if (chat === 1 && ids[0] === 1) await gate;
      order.push(`${chat}:${ids[0]}`);
      return true;
    }),
  });
  e.enqueue(viol({ chatId: 1, messageIds: [1] }));
  e.enqueue(viol({ chatId: 1, messageIds: [2] }));
  e.enqueue(viol({ chatId: 2, messageIds: [3] }));
  await vi.waitFor(() => expect(order).toEqual(["2:3"]));
  release();
  await e.drain();
  expect(order).toEqual(["2:3", "1:1", "1:2"]);
});

test("enqueue retorna sin esperar a Telegram", () => {
  const { e } = setup("production", { getChatMember: vi.fn(() => new Promise(() => {})) });
  expect(e.enqueue(viol())).toBeUndefined();
});

test("si el insert del evento falla, registra y la cola del mismo chat sigue", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { api, e } = setup();
  e.enqueue(viol({ chatId: 999 }));
  e.enqueue(viol({ chatId: 999, messageIds: [8] }));
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledWith(999, [8]);
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

test("si el procesamiento rechaza, registra y el siguiente del mismo chat se ejecuta", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { api, e } = setup();
  const bad = viol();
  Object.defineProperty(bad, "messageIds", { get() { throw new Error("roto"); } });
  e.enqueue(bad);
  e.enqueue(viol({ messageIds: [8] }));
  await e.drain();
  expect(err).toHaveBeenCalled();
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [8]);
  expect(events()).toHaveLength(1);
  err.mockRestore();
});

const channel = (id = -300) => ({ type: "chat" as const, id, name: "Canal" });

test("canal vinculado con fila desactualizada: no borra, no banea, no registra y actualiza la fila", async () => {
  expect(getChat(db, 1)!.linkedChatId).toBeNull();
  const { api, e } = setup("production", { getChat: vi.fn(async () => ({ id: 1, type: "supergroup", title: "A", linked_chat_id: -300 })) });
  e.enqueue(viol({ sender: channel(), adminCheckUserId: null }));
  await e.drain();
  expect(api.getChat).toHaveBeenCalledWith(1);
  expect(api.deleteMessages).not.toHaveBeenCalled();
  expect(api.banChatSenderChat).not.toHaveBeenCalled();
  expect(events()).toHaveLength(0);
  expect(getChat(db, 1)!.linkedChatId).toBe(-300);
});

test("si getChat falla con un canal: no borra ni banea, y registra el error", async () => {
  const { api, e } = setup("production", { getChat: vi.fn(async () => { throw new Error("sin red"); }) });
  e.enqueue(viol({ sender: channel(), adminCheckUserId: null }));
  await e.drain();
  expect(api.deleteMessages).not.toHaveBeenCalled();
  expect(api.banChatSenderChat).not.toHaveBeenCalled();
  expect(events()[0]).toMatchObject({ deleteOk: null, banOk: null });
  expect(events()[0]!.error).toContain("sin red");
});

test("un canal distinto del vinculado sí se banea", async () => {
  const { api, e } = setup("production", { getChat: vi.fn(async () => ({ id: 1, type: "supergroup", title: "A", linked_chat_id: -999 })) });
  e.enqueue(viol({ sender: channel(), adminCheckUserId: null }));
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [7]);
  expect(api.banChatSenderChat).toHaveBeenCalledWith(1, -300);
  expect(events()[0]).toMatchObject({ banOk: true });
});

test("development: un canal vinculado tampoco se borra", async () => {
  const { api, e } = setup("development", { getChat: vi.fn(async () => ({ id: 1, type: "supergroup", title: "A", linked_chat_id: -300 })) });
  e.enqueue(viol({ sender: channel(), adminCheckUserId: null }));
  await e.drain();
  expect(api.getChat).toHaveBeenCalled();
  expect(api.deleteMessages).not.toHaveBeenCalled();
  expect(events()).toHaveLength(0);
});

test("un usuario no consulta getChat", async () => {
  const { api, e } = setup();
  e.enqueue(viol());
  await e.drain();
  expect(api.getChat).not.toHaveBeenCalled();
});

test("si el borrado falla: deleteOk false, error guardado y el ban se intenta igual", async () => {
  const { api, e } = setup("production", { deleteMessages: vi.fn(async () => { throw new Error("no se puede borrar"); }) });
  e.enqueue(viol());
  await e.drain();
  expect(api.banChatMember).toHaveBeenCalledWith(1, 10);
  expect(events()[0]).toMatchObject({ deleteOk: false, banOk: true });
  expect(events()[0]!.error).toContain("no se puede borrar");
});

test("un error que no es 429 no se reintenta", async () => {
  const { api, sleep, e } = setup("production", { deleteMessages: vi.fn(async () => { throw serverError(); }) });
  e.enqueue(viol());
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("el reintento por 429 se detiene a los 3 intentos", async () => {
  const { api, sleep, e } = setup("production", { deleteMessages: vi.fn(async () => { throw tooMany(); }) });
  e.enqueue(viol());
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
  expect(events()[0]).toMatchObject({ deleteOk: false });
});

test("development con acción delete: dryRun false", async () => {
  const { e } = setup("development");
  e.enqueue(viol({ action: "delete" }));
  await e.drain();
  expect(events()[0]).toMatchObject({ dryRun: false, deleteOk: true });
});

test("development con un canal: no llama a banChatSenderChat", async () => {
  const { api, e } = setup("development");
  e.enqueue(viol({ sender: channel(), adminCheckUserId: null }));
  await e.drain();
  expect(api.banChatSenderChat).not.toHaveBeenCalled();
  expect(api.deleteMessages).toHaveBeenCalled();
});
