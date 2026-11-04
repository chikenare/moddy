import { GrammyError } from "grammy";
import { beforeEach, expect, test, vi } from "vitest";
import { getChat, insertChat, updateChatInfo } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type NewEvent, getEvent, insertEvent } from "../db/events.js";
import { addWord, listWords } from "../db/lists.js";
import { recordSeenUser } from "../db/staff.js";
import { type ApiTelegram, createApi } from "./app.js";

let db: Db;
let telegram: { [K in keyof ApiTelegram]: ReturnType<typeof vi.fn> };
let app: ReturnType<typeof createApi>;
let queued: ReturnType<typeof vi.fn<() => void>>;

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
  queued = vi.fn<() => void>();
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  insertChat(db, { id: CHANNEL, type: "channel", title: "Canal", username: null }, []);
  telegram = {
    leaveChat: vi.fn().mockResolvedValue(true), unbanChatMember: vi.fn().mockResolvedValue(true), unbanChatSenderChat: vi.fn().mockResolvedValue(true),
    getChatMember: vi.fn().mockResolvedValue({ status: "member", user: { id: 77, is_bot: false, first_name: "Bea", last_name: "Ruiz" } }),
  };
  app = createApi({ db, telegram: telegram as unknown as ApiTelegram, appEnv: "development", botUsername: () => "mi_bot", onMessageQueued: queued });
});

test("health devuelve estado, entorno y usuario del bot", async () => {
  const r = await get("/api/health");
  expect(await r.json()).toEqual({ status: "ok", appEnv: "development", botUsername: "mi_bot" });
});

const inFuture = () => Math.floor(Date.now() / 1000) + 3600;

test("messages: sending now queues it for the chosen chats and wakes the scheduler", async () => {
  const r = await post("/api/messages", { text: "  Hello  ", chatIds: [CHAT, CHANNEL], sendAt: null });
  expect(r.status).toBe(201);
  const created = await r.json() as { id: number; text: string; sendAt: number; targets: { chatId: number; status: string }[] };
  expect(created.text).toBe("Hello");
  expect(created.targets.map((t) => t.chatId).sort()).toEqual([CHANNEL, CHAT].sort());
  expect(created.targets.every((t) => t.status === "pending")).toBe(true);
  expect(Math.abs(created.sendAt - Date.now() / 1000)).toBeLessThan(5);
  expect(queued).toHaveBeenCalledTimes(1);
  expect(await (await get("/api/messages")).json()).toMatchObject({ messages: [{ id: created.id }] });
});

test("messages: a scheduled one keeps its time", async () => {
  const sendAt = inFuture();
  const r = await post("/api/messages", { text: "Later", chatIds: [CHAT], sendAt });
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ sendAt });
});

test("messages: repeated chats are sent once", async () => {
  const r = await post("/api/messages", { text: "Hi", chatIds: [CHAT, CHAT], sendAt: null });
  expect(((await r.json()) as { targets: unknown[] }).targets).toHaveLength(1);
});

test.each([
  [{ text: "  ", chatIds: [CHAT], sendAt: null }, "Message must be between 1 and 4000 characters"],
  [{ text: "x".repeat(4001), chatIds: [CHAT], sendAt: null }, "Message must be between 1 and 4000 characters"],
  [{ text: "Hi", chatIds: [], sendAt: null }, "Choose at least one chat"],
  [{ text: "Hi", chatIds: [-999], sendAt: null }, "Chat not available: -999"],
  [{ text: "Hi", chatIds: [CHAT], sendAt: 100 }, "Choose a time in the future"],
  [{ text: "Hi", chatIds: [CHAT], sendAt: Math.floor(Date.now() / 1000) + 400 * 86_400 }, "Choose a time within the next year"],
  [{ text: "Hi", chatIds: "all", sendAt: null }, "Invalid value"],
])("messages: %j is refused", async (body, error) => {
  const r = await post("/api/messages", body);
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error });
  expect(queued).not.toHaveBeenCalled();
});

test("messages: a chat the bot has left is refused by name", async () => {
  updateChatInfo(db, CHAT, { botStatus: "left" });
  const r = await post("/api/messages", { text: "Hi", chatIds: [CHAT], sendAt: null });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Chat not available: Grupo" });
});

test("messages: cancel stops what is pending; a second cancel gives 409; unknown gives 404", async () => {
  const created = await (await post("/api/messages", { text: "Later", chatIds: [CHAT], sendAt: inFuture() })).json() as { id: number };
  const r = await post(`/api/messages/${created.id}/cancel`);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ targets: [{ status: "cancelled" }] });
  const again = await post(`/api/messages/${created.id}/cancel`);
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "Nothing left to cancel" });
  const missing = await post("/api/messages/9999/cancel");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Message not found" });
});

test("messages: the host guard applies", async () => {
  expect((await get("/api/messages", { Host: "evil.example" })).status).toBe(403);
  expect((await post("/api/messages", { text: "Hi", chatIds: [CHAT], sendAt: null }, { Origin: "https://evil.example" })).status).toBe(403);
});

test("rules are saved trimmed and can be cleared; over 4000 characters is refused", async () => {
  const saved = await patch("/api/chats/-100", { rules: "  Be nice  " });
  expect(await saved.json()).toMatchObject({ rules: "Be nice" });
  expect(await (await patch("/api/chats/-100", { rules: "" })).json()).toMatchObject({ rules: "" });
  const long = await patch("/api/chats/-100", { rules: "x".repeat(4001) });
  expect(long.status).toBe(400);
  expect(await long.json()).toEqual({ error: "Rules must be at most 4000 characters" });
});

test("staff: add by id checks Telegram and uses the real name", async () => {
  const r = await post("/api/chats/-100/staff", { user: "77" });
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ userId: 77, displayName: "Bea Ruiz" });
  expect(telegram.getChatMember).toHaveBeenCalledWith(CHAT, 77);
  expect(await (await get("/api/chats/-100/staff")).json()).toMatchObject({ staff: [{ userId: 77, displayName: "Bea Ruiz" }] });
});

test("staff: add by @username uses the users the bot has seen, ignoring case", async () => {
  recordSeenUser(db, CHAT, { id: 5, username: "juanp", displayName: "Juan" });
  const r = await post("/api/chats/-100/staff", { user: "@JuanP" });
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ userId: 5, displayName: "Juan" });
  expect(telegram.getChatMember).not.toHaveBeenCalled();
});

test("staff: an unseen @username gets a useful message", async () => {
  const r = await post("/api/chats/-100/staff", { user: "@nobody" });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "The bot hasn't seen @nobody in this group yet. Ask them to send a message, or add them by ID." });
});

test.each(["", "  ", "no valid!", "@a b", "12345678901234567890"])("staff: %j is refused", async (user) => {
  const r = await post("/api/chats/-100/staff", { user });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Enter a @username or a numeric user ID" });
  expect(telegram.getChatMember).not.toHaveBeenCalled();
});

test("staff: an id Telegram doesn't know gives 400; other Telegram errors give 502", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  telegram.getChatMember.mockRejectedValueOnce(grammyError(400));
  const missing = await post("/api/chats/-100/staff", { user: "77" });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: "User not found in this group" });
  telegram.getChatMember.mockRejectedValueOnce(grammyError(500));
  expect((await post("/api/chats/-100/staff", { user: "77" })).status).toBe(502);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("Could not check"), expect.any(Error));
  expect(await (await get("/api/chats/-100/staff")).json()).toEqual({ staff: [] });
});

test("staff: bots are refused", async () => {
  telegram.getChatMember.mockResolvedValueOnce({ status: "member", user: { id: 77, is_bot: true, first_name: "B" } });
  const r = await post("/api/chats/-100/staff", { user: "77" });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Bots can't be staff" });
});

test("staff: removal gives 204, then 404", async () => {
  await post("/api/chats/-100/staff", { user: "77" });
  expect((await del("/api/chats/-100/staff/77")).status).toBe(204);
  const again = await del("/api/chats/-100/staff/77");
  expect(again.status).toBe(404);
  expect(await again.json()).toEqual({ error: "Staff member not found" });
});

test("auto replies: triggers are normalized and de-duplicated, text is trimmed", async () => {
  const r = await post("/api/chats/-100/auto-replies", { triggers: [" Premium ", "VIP", "vip"], reply: "  Get it: https://x.example  " });
  expect(r.status).toBe(201);
  const created = await r.json() as { id: number };
  expect(created).toMatchObject({ triggers: ["premium", "vip"], reply: "Get it: https://x.example" });
  expect(await (await get("/api/chats/-100/auto-replies")).json()).toMatchObject({ autoReplies: [{ id: created.id }] });
});

test.each([
  [{ triggers: [], reply: "x" }, "Add at least one trigger"],
  [{ triggers: ["  "], reply: "x" }, "Each trigger must be between 2 and 100 characters"],
  [{ triggers: ["a"], reply: "x" }, "Each trigger must be between 2 and 100 characters"],
  [{ triggers: Array.from({ length: 21 }, (_, i) => `word${i}`), reply: "x" }, "Use at most 20 triggers"],
  [{ triggers: ["premium"], reply: "   " }, "Reply must be between 1 and 4000 characters"],
  [{ triggers: ["premium"], reply: "x".repeat(4001) }, "Reply must be between 1 and 4000 characters"],
  [{ triggers: "premium", reply: "x" }, "Invalid value"],
])("auto replies: %j is refused", async (body, error) => {
  const r = await post("/api/chats/-100/auto-replies", body);
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error });
});

test("auto replies: styles are saved, moved with trimming, and default to none", async () => {
  const styled = await post("/api/chats/-100/auto-replies", {
    triggers: ["premium"], reply: "  Get it  ",
    entities: [{ type: "bold", offset: 2, length: 3 }, { type: "text_link", offset: 6, length: 2, url: "https://x.example" }],
  });
  expect(styled.status).toBe(201);
  const created = await styled.json() as { id: number };
  expect(created).toMatchObject({
    reply: "Get it",
    entities: [{ type: "bold", offset: 0, length: 3 }, { type: "text_link", offset: 4, length: 2, url: "https://x.example" }],
  });
  const plain = await send("PUT", `/api/chats/-100/auto-replies/${created.id}`, { triggers: ["premium"], reply: "Plain" });
  expect(await plain.json()).toMatchObject({ reply: "Plain", entities: [] });
});

test.each([
  [{ type: "bold", offset: 0, length: 99 }],
  [{ type: "mention", offset: 0, length: 1 }],
  [{ type: "text_link", offset: 0, length: 1, url: "javascript:alert(1)" }],
  [{ type: "bold", offset: "0", length: 1 }],
])("auto replies: bad style %j is refused", async (entity) => {
  const r = await post("/api/chats/-100/auto-replies", { triggers: ["premium"], reply: "x", entities: [entity] });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Invalid formatting" });
});

test("auto replies: more than 100 styled parts is refused", async () => {
  const entities = Array.from({ length: 101 }, (_, i) => ({ type: "bold", offset: i * 2, length: 1 }));
  const r = await post("/api/chats/-100/auto-replies", { triggers: ["premium"], reply: "x ".repeat(120), entities });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Too much formatting: use at most 100 styled parts" });
});

test("auto replies: a trigger can't be used by two replies in one group", async () => {
  await post("/api/chats/-100/auto-replies", { triggers: ["premium"], reply: "A" });
  const r = await post("/api/chats/-100/auto-replies", { triggers: ["vip", "PREMIUM"], reply: "B" });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Trigger already in use: premium" });
  const other = await post("/api/chats/-200/auto-replies", { triggers: ["premium"], reply: "C" });
  expect(other.status).toBe(201);
});

test("auto replies: update may keep its own triggers but not take another's", async () => {
  const a = await (await post("/api/chats/-100/auto-replies", { triggers: ["premium"], reply: "A" })).json() as { id: number };
  await post("/api/chats/-100/auto-replies", { triggers: ["help"], reply: "B" });
  const kept = await send("PUT", `/api/chats/-100/auto-replies/${a.id}`, { triggers: ["premium", "vip"], reply: "A2" });
  expect(kept.status).toBe(200);
  expect(await kept.json()).toMatchObject({ triggers: ["premium", "vip"], reply: "A2" });
  const taken = await send("PUT", `/api/chats/-100/auto-replies/${a.id}`, { triggers: ["help"], reply: "A3" });
  expect(taken.status).toBe(400);
  const missing = await send("PUT", "/api/chats/-100/auto-replies/9999", { triggers: ["zz"], reply: "x" });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Auto reply not found" });
});

test("auto replies: deletion gives 204, then 404, and the switch is saved", async () => {
  const a = await (await post("/api/chats/-100/auto-replies", { triggers: ["premium"], reply: "A" })).json() as { id: number };
  expect((await del(`/api/chats/-100/auto-replies/${a.id}`)).status).toBe(204);
  expect((await del(`/api/chats/-100/auto-replies/${a.id}`)).status).toBe(404);
  expect(await (await patch("/api/chats/-100", { autoRepliesEnabled: true })).json()).toMatchObject({ autoRepliesEnabled: true });
});

test("el aviso se puede encender y personalizar; se recorta el texto", async () => {
  const r = await patch("/api/chats/-100", { noticeEnabled: true, noticeTemplate: "  Bye {user}  " });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ noticeEnabled: true, noticeTemplate: "Bye {user}" });
});

test.each(["   ", "x".repeat(501)])("una plantilla de aviso inválida da 400 legible", async (noticeTemplate) => {
  const r = await patch("/api/chats/-100", { noticeTemplate });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Notice must be between 1 and 500 characters" });
});

test("health devuelve botUsername null si el bot aún no ha iniciado", async () => {
  app = createApi({ db, telegram: telegram as unknown as ApiTelegram, appEnv: "development", botUsername: () => null, onMessageQueued: queued });
  const r = await get("/api/health");
  expect(await r.json()).toEqual({ status: "ok", appEnv: "development", botUsername: null });
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
test.each(["null", "no es una url"])("escritura con Origin %j da 403", async (origin) => {
  const r = await patch("/api/chats/-100", { floodCount: 6 }, { Host: "localhost:5173", Origin: origin });
  expect(r.status).toBe(403);
  expect(getChat(db, CHAT)!.floodCount).not.toBe(6);
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
test.each([
  [{ floodCount: 1 }, "Message count must be between 2 and 50"],
  [{ floodCount: 51 }, "Message count must be between 2 and 50"],
  [{ floodSeconds: 0 }, "Seconds must be between 1 and 3600"],
  [{ floodSeconds: 3601 }, "Seconds must be between 1 and 3600"],
  [{ linkFilterAction: "kick" }, "Invalid value"],
  [{ moderationEnabled: "si" }, "Invalid value"],
])("PATCH %j da el mensaje legible %s", async (body, message) => {
  const r = await patch("/api/chats/-100", body);
  expect(await r.json()).toEqual({ error: message });
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
  expect((await post("/api/chats/-100/words", { word: 5 })).status).toBe(400);
  expect((await del("/api/chats/-100/words?word=co%C3%B1o")).status).toBe(204);
  expect(listWords(db, CHAT)).toEqual([]);
  expect((await del("/api/chats/-100/words?word=nada")).status).toBe(404);
  expect((await del("/api/chats/-100/words")).status).toBe(404);
});
test.each(["xxx", "a", "  A ", "ab".repeat(51)])("palabra %j fuera de 2 a 100 caracteres da 400 con mensaje", async (word) => {
  const r = await post("/api/chats/-100/words", { word });
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Word must be between 2 and 100 characters" });
  expect(listWords(db, CHAT)).toEqual([]);
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
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  telegram.unbanChatMember.mockRejectedValue(new Error("red caída"));
  const e = insertEvent(db, ev());
  const r = await post(`/api/chats/-100/events/${e.id}/unban`);
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({ error: expect.any(String) });
  expect(getEvent(db, CHAT, e.id)!.unbannedAt).toBeNull();
  expect(err).toHaveBeenCalledWith(expect.stringContaining("Could not unban"), expect.any(Error));
  err.mockRestore();
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
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
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
  expect(err).toHaveBeenCalledTimes(2);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("Could not leave"), expect.any(Error));
  err.mockRestore();
});

test("ruta desconocida bajo /api da 404 JSON", async () => {
  const r = await get("/api/nada");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: expect.any(String) });
});
