import { beforeEach, expect, test } from "vitest";
import { insertChat } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { insertEvent } from "./events.js";
import { addDailyStats, getMetrics, purgeStats } from "./stats.js";

const NOW = Date.UTC(2026, 10, 10, 15);
let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: -1, type: "supergroup", title: "Alpha", username: null }, []);
  insertChat(db, { id: -2, type: "supergroup", title: "Beta", username: null }, []);
});

test("returns every day of the period, with zeros, in UTC", () => {
  addDailyStats(db, [{ chatId: -1, day: "2026-11-10", counts: { messages: 5 } }, { chatId: -1, day: "2026-11-05", counts: { messages: 2 } }]);
  const m = getMetrics(db, { days: 7, nowMs: NOW });
  expect(m.series.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
  expect(m.series.map((d) => d.messages)).toEqual([0, 2, 0, 0, 0, 0, 5]);
  expect([m.from, m.to]).toEqual(["2026-11-04", "2026-11-10"]);
});

test("totals and the previous period of the same length", () => {
  addDailyStats(db, [
    { chatId: -1, day: "2026-11-10", counts: { messages: 10, joins: 1 } },
    { chatId: -2, day: "2026-11-04", counts: { messages: 5 } },
    { chatId: -1, day: "2026-11-03", counts: { messages: 4 } },   // previous period starts 2026-10-28
    { chatId: -1, day: "2026-10-28", counts: { messages: 1 } },
    { chatId: -1, day: "2026-10-27", counts: { messages: 100 } }, // outside both
  ]);
  const m = getMetrics(db, { days: 7, nowMs: NOW });
  expect(m.totals).toMatchObject({ messages: 15, joins: 1 });
  expect(m.previous).toMatchObject({ messages: 5, joins: 0 });
});

test("a chat scope limits totals, series and top lists", () => {
  addDailyStats(db, [{ chatId: -1, day: "2026-11-10", counts: { messages: 10 } }, { chatId: -2, day: "2026-11-10", counts: { messages: 7 } }]);
  const m = getMetrics(db, { days: 7, chatId: -2, nowMs: NOW });
  expect(m.totals.messages).toBe(7);
  expect(m.topChats).toEqual([]);
});

test("ranks the most active groups", () => {
  addDailyStats(db, [
    { chatId: -1, day: "2026-11-10", counts: { messages: 10, link_hits: 2 } },
    { chatId: -2, day: "2026-11-10", counts: { messages: 30 } },
  ]);
  expect(getMetrics(db, { days: 7, nowMs: NOW }).topChats).toEqual([
    { id: -2, title: "Beta", messages: 30, actions: 0 },
    { id: -1, title: "Alpha", messages: 10, actions: 2 },
  ]);
});

test("top words and domains come from the history of the period", () => {
  const at = Math.floor(NOW / 1000);
  const ev = (filter: "word" | "link", matched: string, o: { chatId?: number; deleteOk?: boolean | null; ago?: number } = {}) =>
    insertEvent(db, {
      chatId: o.chatId ?? -1, senderType: "user", senderId: 1, senderName: "x", filter, matched, text: null,
      action: "delete", deleteOk: o.deleteOk === undefined ? true : o.deleteOk, banOk: null, error: null, dryRun: false,
    }, at - (o.ago ?? 60));
  ev("word", "casino"); ev("word", "casino"); ev("word", "bet", { chatId: -2 });
  ev("link", "https://www.Spam.com/a"); ev("link", "spam.com/b"); ev("link", "http://other.org");
  ev("word", "old", { ago: 30 * 86400 });
  ev("word", "failed", { deleteOk: null });
  ev("link", "???");
  insertEvent(db, { chatId: -1, senderType: "user", senderId: 1, senderName: "x", filter: "flood", matched: "5 messages in 10 s", text: null, action: "delete", deleteOk: true, banOk: null, error: null, dryRun: false }, at);
  const m = getMetrics(db, { days: 7, nowMs: NOW });
  expect(m.topWords).toEqual([{ value: "casino", count: 2 }, { value: "bet", count: 1 }]);
  expect(m.topDomains).toEqual([{ value: "spam.com", count: 2 }, { value: "other.org", count: 1 }]);
  expect(getMetrics(db, { days: 7, chatId: -2, nowMs: NOW }).topWords).toEqual([{ value: "bet", count: 1 }]);
  expect(getMetrics(db, { days: 90, nowMs: NOW }).topWords.map((w) => w.value)).toContain("old");
});

test("purges stats older than 400 days", () => {
  addDailyStats(db, [{ chatId: -1, day: "2025-09-01", counts: { messages: 1 } }, { chatId: -1, day: "2026-11-09", counts: { messages: 1 } }]);
  expect(purgeStats(db, NOW)).toBe(1);
  expect(db.prepare("SELECT day FROM chat_daily_stats").all()).toEqual([{ day: "2026-11-09" }]);
});
