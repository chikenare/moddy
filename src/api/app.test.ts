import { GrammyError } from "grammy";
import { beforeEach, expect, test, vi } from "vitest";
import { getChat, insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type NewEvent, getEvent, insertEvent } from "../db/events.js";
import { addWord, listWords } from "../db/lists.js";
import { type ApiTelegram, createApi } from "./app.js";

let db: Db;
let telegram: { [K in keyof ApiTelegram]: ReturnType<typeof vi.fn> };
let app: ReturnType<typeof createApi>;

const CHAT = -100;
const CHANNEL = -200;

const ev = (o: Partial<NewEvent> = {}): NewEvent => ({
  chatId: CHAT, senderType: "user", senderId: 10, senderName: "x", filter: "link", matched: "m", text: "hola",
  action: "delete_ban", deleteOk: true, banOk: true, error: null, dryRun: false, ...o,
});

const grammyError = (code: number) =>
  new GrammyError("fallo", { ok: false, error_code: code, description: "fallo" }, "leaveChat", {});

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { Host: "bot.localhost", ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return app.request(`http://ignored${path}`, init);
}
const get = (p: string, h?: Record<string, string>) => send("GET", p, undefined, h);
const patch = (p: string, b: unknown, h?: Record<string, string>) => send("PATCH", p, b, h);
const post = (p: string, b?: unknown, h?: Record<string, string>) => send("POST", p, b, h);
const del = (p: string, h?: Record<string, string>) => send("DELETE", p, undefined, h);

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  insertChat(db, { id: CHANNEL, type: "channel", title: "Canal", username: null }, []);
  telegram = { leaveChat: vi.fn().mockResolvedValue(true), unbanChatMember: vi.fn().mockResolvedValue(true), unbanChatSenderChat: vi.fn().mockResolvedValue(true) };
  app = createApi({ db, telegram: telegram as unknown as ApiTelegram, appEnv: "development" });
});

test("health devuelve estado y entorno", async () => {
  const r = await get("/api/health");
  expect(await r.json()).toEqual({ status: "ok", appEnv: "development" });
});

test.each(["bot.localhost", "localhost:9000", "127.0.0.1:8088", "[::1]:5173"])("acepta Host %s", async (host) => {
  expect((await get("/api/health", { Host: host })).status).toBe(200);
});
test.each(["evil.example", "bot.localhost.evil.example"])("rechaza Host %s también en lecturas", async (host) => {
  expect((await get("/api/chats", { Host: host })).status).toBe(403);
});
test("rechaza escrituras con Origin de otro host", async () => {
  const r = await patch("/api/chats/-100", { floodCount: 6 }, { Host: "bot.localhost", Origin: "https://evil.example" });
  expect(r.status).toBe(403);
  expect(r.headers.get("access-control-allow-origin")).toBeNull();
  expect(await r.json()).toEqual({ error: expect.any(String) });
});
test("acepta Origin del mismo host", async () => {
  const r = await patch("/api/chats/-100", { floodCount: 6 }, { Host: "localhost:5173", Origin: "http://localhost:5173" });
  expect(r.status).toBe(200);
  expect(r.headers.get("access-control-allow-origin")).toBeNull();
});
test("Origin del mismo hostname pero otro puerto se rechaza", async () => {
  const r = await patch("/api/chats/-100", { floodCount: 6 }, { Host: "localhost:5173", Origin: "http://localhost:9999" });
  expect(r.status).toBe(403);
});

test("lista y obtiene chats; id desconocido da 404", async () => {
  expect(await (await get("/api/chats")).json()).toHaveLength(2);
  expect(((await (await get("/api/chats/-100")).json()) as { id: number }).id).toBe(CHAT);
  const r = await get("/api/chats/-999");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: expect.any(String) });
});

test.each([
  [{ floodCount: 1 }], [{ floodCount: 51 }], [{ floodSeconds: 0 }], [{ floodSeconds: 3601 }],
  [{ linkFilterAction: "kick" }], [{ title: "x" }],
])("PATCH inválido %j da 400 con mensaje", async (body) => {
  const r = await patch("/api/chats/-100", body);
  expect(r.status).toBe(400);
  const json = (await r.json()) as { error: string };
  expect(typeof json.error).toBe("string");
  expect(json.error.length).toBeGreaterThan(0);
});
test("PATCH parcial guarda y devuelve el chat; id desconocido da 404", async () => {
  const before = getChat(db, CHAT)!;
  const r = await patch("/api/chats/-100", { floodCount: 7, wordFilterAction: "delete" });
  expect(r.status).toBe(200);
  const saved = (await r.json()) as Record<string, unknown>;
  expect(saved).toMatchObject({ id: CHAT, floodCount: 7, wordFilterAction: "delete", linkFilterEnabled: before.linkFilterEnabled, floodSeconds: before.floodSeconds });
  expect(getChat(db, CHAT)).toMatchObject({ floodCount: 7, wordFilterAction: "delete" });
  expect((await patch("/api/chats/-999", { floodCount: 7 })).status).toBe(404);
});
test("un canal no se puede encender", async () => {
  const r = await patch("/api/chats/-200", { moderationEnabled: true });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: expect.any(String) });
  expect(((await (await get("/api/chats/-200")).json()) as { moderationEnabled: boolean }).moderationEnabled).toBe(false);
});
test("JSON mal formado da 400", async () => {
  const r = await patch("/api/chats/-100", "{no es json");
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: expect.any(String) });
});
test("id no numérico no coincide con la ruta", async () => {
  expect((await get("/api/chats/abc")).status).toBe(404);
});

test("palabras: normaliza, duplicada no falla, vacía da 400, borrar por query", async () => {
  const first = await post("/api/chats/-100/words", { word: " Coño " });
  expect(first.status).toBe(201);
  expect(await first.json()).toEqual({ word: "coño" });
  expect((await post("/api/chats/-100/words", { word: "coño" })).status).toBe(201);
  expect(await (await get("/api/chats/-100/words")).json()).toEqual({ words: ["coño"] });
  expect((await post("/api/chats/-100/words", { word: "  " })).status).toBe(400);
  expect((await post("/api/chats/-100/words", {})).status).toBe(400);
  expect((await del("/api/chats/-100/words?word=co%C3%B1o")).status).toBe(204);
  expect(listWords(db, CHAT)).toEqual([]);
  expect((await del("/api/chats/-100/words?word=nada")).status).toBe(404);
  expect((await del("/api/chats/-100/words")).status).toBe(404);
});
test("subrutas de un chat desconocido dan 404", async () => {
  expect((await get("/api/chats/-999/words")).status).toBe(404);
  expect((await get("/api/chats/-999/whitelist")).status).toBe(404);
  expect((await get("/api/chats/-999/events")).status).toBe(404);
  expect((await post("/api/chats/-999/words", { word: "a" })).status).toBe(404);
});

test("lista blanca: normaliza, inválida da 400 legible, borra con barra", async () => {
  const r = await post("/api/chats/-100/whitelist", { entry: "t.me/MiCanal/" });
  expect(r.status).toBe(201);
  expect(await r.json()).toEqual({ entry: "t.me/micanal" });
  expect(await (await get("/api/chats/-100/whitelist")).json()).toEqual({ entries: ["t.me/micanal"] });
  const bad = await post("/api/chats/-100/whitelist", { entry: "sin punto" });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error.length).toBeGreaterThan(0);
  expect((await del("/api/chats/-100/whitelist?entry=t.me%2Fmicanal")).status).toBe(204);
  expect((await del("/api/chats/-100/whitelist?entry=t.me%2Fmicanal")).status).toBe(404);
});

test("eventos paginan con nextBefore", async () => {
  const ids = [1, 2, 3, 4, 5].map((i) => insertEvent(db, ev({ senderId: i })).id);
  const page1 = (await (await get("/api/chats/-100/events?limit=2")).json()) as { events: { id: number }[]; nextBefore: number | null };
  expect(page1.events.map((e) => e.id)).toEqual([ids[4], ids[3]]);
  expect(page1.nextBefore).toBe(ids[3]);
  const page2 = (await (await get(`/api/chats/-100/events?limit=2&before=${page1.nextBefore}`)).json()) as typeof page1;
  expect(page2.events.map((e) => e.id)).toEqual([ids[2], ids[1]]);
  const last = (await (await get(`/api/chats/-100/events?limit=2&before=${ids[1]}`)).json()) as typeof page1;
  expect(last.events.map((e) => e.id)).toEqual([ids[0]]);
  expect(last.nextBefore).toBeNull();
});
test("eventos: limit por defecto 50, máximo 100 y valores inválidos dan 400", async () => {
  for (let i = 0; i < 120; i++) insertEvent(db, ev({ senderId: i }));
  const def = (await (await get("/api/chats/-100/events")).json()) as { events: unknown[] };
  expect(def.events).toHaveLength(50);
  expect(((await (await get("/api/chats/-100/events?limit=100")).json()) as { events: unknown[] }).events).toHaveLength(100);
  expect((await get("/api/chats/-100/events?limit=101")).status).toBe(400);
  expect((await get("/api/chats/-100/events?limit=0")).status).toBe(400);
  expect((await get("/api/chats/-100/events?before=abc")).status).toBe(400);
});

test("desbanear usuario usa only_if_banned y marca el evento", async () => {
  const e = insertEvent(db, ev());
  const r = await post(`/api/chats/-100/events/${e.id}/unban`);
  expect(r.status).toBe(200);
  expect(telegram.unbanChatMember).toHaveBeenCalledWith(CHAT, 10, { only_if_banned: true });
  expect(((await r.json()) as { unbannedAt: number | null }).unbannedAt).not.toBeNull();
  expect(getEvent(db, CHAT, e.id)!.unbannedAt).not.toBeNull();
});
test("desbanear canal usa unbanChatSenderChat", async () => {
  const e = insertEvent(db, ev({ senderType: "chat", senderId: -300 }));
  const r = await post(`/api/chats/-100/events/${e.id}/unban`);
  expect(r.status).toBe(200);
  expect(telegram.unbanChatSenderChat).toHaveBeenCalledWith(CHAT, -300);
  expect(telegram.unbanChatMember).not.toHaveBeenCalled();
});
test("desbanear simulado o ya deshecho da 409", async () => {
  const dry = insertEvent(db, ev({ dryRun: true }));
  const noBan = insertEvent(db, ev({ banOk: null }));
  expect((await post(`/api/chats/-100/events/${dry.id}/unban`)).status).toBe(409);
  expect((await post(`/api/chats/-100/events/${noBan.id}/unban`)).status).toBe(409);
  const real = insertEvent(db, ev());
  expect((await post(`/api/chats/-100/events/${real.id}/unban`)).status).toBe(200);
  expect((await post(`/api/chats/-100/events/${real.id}/unban`)).status).toBe(409);
  expect(telegram.unbanChatMember).toHaveBeenCalledTimes(1);
});
test("desbanear un evento inexistente da 404", async () => {
  expect((await post("/api/chats/-100/events/999/unban")).status).toBe(404);
});
test("si Telegram falla al desbanear da 502 y no marca", async () => {
  telegram.unbanChatMember.mockRejectedValue(new Error("red caída"));
  const e = insertEvent(db, ev());
  const r = await post(`/api/chats/-100/events/${e.id}/unban`);
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({ error: expect.any(String) });
  expect(getEvent(db, CHAT, e.id)!.unbannedAt).toBeNull();
});

test("salir y olvidar llama leaveChat y borra", async () => {
  addWord(db, CHAT, "a");
  const r = await del("/api/chats/-100");
  expect(r.status).toBe(204);
  expect(telegram.leaveChat).toHaveBeenCalledWith(CHAT);
  expect((await get("/api/chats/-100")).status).toBe(404);
  expect((await del("/api/chats/-100")).status).toBe(404);
});
test("si el bot ya no estaba (400/403) también borra; otro error da 502 y conserva", async () => {
  telegram.leaveChat.mockRejectedValueOnce(grammyError(403));
  expect((await del("/api/chats/-100")).status).toBe(204);
  expect((await get("/api/chats/-100")).status).toBe(404);

  telegram.leaveChat.mockRejectedValueOnce(grammyError(400));
  expect((await del("/api/chats/-200")).status).toBe(204);

  insertChat(db, { id: -300, type: "group", title: "C", username: null }, []);
  telegram.leaveChat.mockRejectedValueOnce(grammyError(500));
  expect((await del("/api/chats/-300")).status).toBe(502);
  telegram.leaveChat.mockRejectedValueOnce(new Error("red caída"));
  expect((await del("/api/chats/-300")).status).toBe(502);
  expect((await get("/api/chats/-300")).status).toBe(200);
});

test("ruta desconocida bajo /api da 404 JSON", async () => {
  const r = await get("/api/nada");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: expect.any(String) });
});
