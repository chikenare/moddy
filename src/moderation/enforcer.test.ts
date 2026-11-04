import { GrammyError } from "grammy";
import { beforeEach, expect, test, vi } from "vitest";
import { insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { listEvents } from "../db/events.js";
import type { AppEnv } from "../env.js";
import { type EnforcerApi, type Violation, createEnforcer } from "./enforcer.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
  for (const id of [1, 2]) insertChat(db, { id, type: "group", title: "A", username: null }, []);
});

const viol = (o: Partial<Violation> = {}): Violation => ({
  chatId: 1, sender: { type: "user", id: 10, name: "Ana" }, filter: "link", matched: "x.com", text: "hola",
  action: "delete_ban", messageIds: [7], adminCheckUserId: 10, ...o,
});

function setup(appEnv: AppEnv = "production", over: Partial<Record<keyof EnforcerApi, unknown>> = {}) {
  const api = {
    getChatMember: vi.fn(async () => ({ status: "member" })),
    deleteMessages: vi.fn(async () => true),
    banChatMember: vi.fn(async () => true),
    banChatSenderChat: vi.fn(async () => true),
    ...over,
  };
  const sleep = vi.fn(async () => {});
  const e = createEnforcer({ api: api as unknown as EnforcerApi, db, appEnv, sleep });
  return { api, sleep, e };
}
const events = (chat = 1) => listEvents(db, chat, { limit: 10 });
const tooMany = () => new GrammyError("x", { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } }, "deleteMessages", {});

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

test("si el insert del evento falla, registra y la cola sigue", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { api, e } = setup();
  e.enqueue(viol({ chatId: 999 }));
  e.enqueue(viol({ messageIds: [8] }));
  await e.drain();
  expect(api.deleteMessages).toHaveBeenCalledWith(1, [8]);
  expect(events()).toHaveLength(1);
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});
