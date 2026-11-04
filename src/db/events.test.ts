import { beforeEach, expect, test } from "vitest";
import { insertChat } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { type NewEvent, getEvent, insertEvent, isActiveBan, listEvents, markUnbanned, purgeEvents } from "./events.js";

const DAY = 86400;
const chat = 1;
let db: Db;

const ev = (o: Partial<NewEvent> = {}): NewEvent => ({
  chatId: chat, senderType: "user", senderId: 5, senderName: "x", filter: "link", matched: "m", text: "hola",
  action: "delete_ban", deleteOk: true, banOk: true, error: null, dryRun: false, ...o,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: chat, type: "group", title: "A", username: null }, []);
});

test("trunca el texto a 1000 caracteres", () => {
  expect(insertEvent(db, ev({ text: "x".repeat(1500) })).text).toHaveLength(1000);
});

test("insertEvent devuelve el registro con booleanos y fecha", () => {
  const e = insertEvent(db, ev({ banOk: null }), 123);
  expect(e).toMatchObject({ chatId: chat, dryRun: false, deleteOk: true, banOk: null, unbannedAt: null, createdAt: 123 });
});

test("listEvents pagina del más nuevo al más viejo", () => {
  const ids = [1, 2, 3, 4, 5].map((i) => insertEvent(db, ev({ senderId: i })).id);
  const first = listEvents(db, chat, { limit: 2 });
  expect(first.map((e) => e.id)).toEqual([ids[4], ids[3]]);
  const next = listEvents(db, chat, { limit: 2, before: ids[3] });
  expect(next.map((e) => e.id)).toEqual([ids[2], ids[1]]);
});

test("markUnbanned marca todos los bans activos de ese remitente en ese chat", () => {
  const a = insertEvent(db, ev());
  const b = insertEvent(db, ev());
  const otro = insertEvent(db, ev({ senderId: 6 }));
  const simulado = insertEvent(db, ev({ dryRun: true }));
  markUnbanned(db, chat, "user", 5, 999);
  expect(getEvent(db, chat, a.id)?.unbannedAt).toBe(999);
  expect(getEvent(db, chat, b.id)?.unbannedAt).toBe(999);
  expect(getEvent(db, chat, otro.id)?.unbannedAt).toBeNull();
  expect(getEvent(db, chat, simulado.id)?.unbannedAt).toBeNull();
  expect(isActiveBan(getEvent(db, chat, a.id)!)).toBe(false);
  expect(isActiveBan(otro)).toBe(true);
});

test("purgeEvents conserva bans vigentes sin texto y elimina el resto de lo antiguo", () => {
  const now = 200 * DAY;
  const old = now - 91 * DAY;
  const banVigente = insertEvent(db, ev({ senderId: 1 }), old);
  const simulado = insertEvent(db, ev({ senderId: 2, dryRun: true }), old);
  const deshecho = insertEvent(db, ev({ senderId: 3 }), old);
  markUnbanned(db, chat, "user", 3, now - DAY);
  const soloBorrado = insertEvent(db, ev({ senderId: 4, action: "delete", banOk: null }), old);
  const banReciente = insertEvent(db, ev({ senderId: 5 }), now - DAY);
  expect(purgeEvents(db, now)).toBe(3);
  expect(getEvent(db, chat, banVigente.id)?.text).toBeNull();
  expect(getEvent(db, chat, simulado.id)).toBeUndefined();
  expect(getEvent(db, chat, deshecho.id)).toBeUndefined();
  expect(getEvent(db, chat, soloBorrado.id)).toBeUndefined();
  expect(getEvent(db, chat, banReciente.id)?.text).not.toBeNull();
});
