import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { insertChat, migrateChatId, updateChatSettings } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type StatRow, STAT_FIELDS } from "../db/stats.js";
import { createStatsCollector } from "./collector.js";
import { createEnforcer, type EnforcerApi, type Violation } from "../moderation/enforcer.js";
import { createSeenUsersHandler } from "../moderation/seen.js";
import { createAutoRepliesHandler } from "../community/auto-replies.js";
import { createScheduler, type SchedulerApi } from "../messages/scheduler.js";
import { createMessage } from "../db/messages.js";
import { insertAutoReply } from "../db/auto-replies.js";
import { runShutdown } from "../shutdown.js";
import { createTestBot } from "../test/harness.js";
import { groupMessage } from "../test/updates.js";

const DAY1 = Date.UTC(2026, 10, 4, 12);
let db: Db;
let clock: number;

beforeEach(() => {
  clock = DAY1;
  db = openDatabase(":memory:");
  insertChat(db, { id: -100, type: "supergroup", title: "On", username: null }, []);
  insertChat(db, { id: -200, type: "supergroup", title: "Off", username: null }, []);
  updateChatSettings(db, -100, { moderationEnabled: true, autoRepliesEnabled: true });
});

const rows = () => db.prepare("SELECT * FROM chat_daily_stats ORDER BY chat_id, day").all() as Array<Record<string, number | string>>;
const collector = () => createStatsCollector({ db, now: () => clock });

test("accumulates in memory and writes one batch on flush", () => {
  const c = collector();
  c.add(-100, "messages"); c.add(-100, "messages", 2); c.add(-100, "joins");
  expect(rows()).toEqual([]);
  c.flush();
  expect(rows()).toEqual([expect.objectContaining({ chat_id: -100, day: "2026-11-04", messages: 3, joins: 1, leaves: 0 })]);
  c.add(-100, "messages");
  c.flush();
  expect(rows()[0]).toMatchObject({ messages: 4 });
});

test("flushes by itself every interval and when stopped", () => {
  vi.useFakeTimers();
  try {
    const c = createStatsCollector({ db, now: () => clock, flushMs: 30_000 });
    c.start();
    c.add(-100, "messages");
    vi.advanceTimersByTime(30_000);
    expect(rows()[0]).toMatchObject({ messages: 1 });
    c.add(-100, "messages");
    c.stop();
    expect(rows()[0]).toMatchObject({ messages: 2 });
  } finally {
    vi.useRealTimers();
  }
});

test("keeps the counts when saving fails and writes them next time", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const c = collector();
  c.add(-100, "messages", 5);
  db.exec("ALTER TABLE chat_daily_stats RENAME TO hidden");
  c.flush();
  expect(err).toHaveBeenCalled();
  db.exec("ALTER TABLE hidden RENAME TO chat_daily_stats");
  c.add(-100, "messages");
  c.flush();
  expect(rows()[0]).toMatchObject({ messages: 6 });
  err.mockRestore();
});

test("an error counting never escapes", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const c = collector();
  db.close();
  expect(() => c.add(-100, "messages")).not.toThrow();
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

test("splits counts by UTC day", () => {
  const c = collector();
  clock = Date.UTC(2026, 10, 4, 23, 59, 59);
  c.add(-100, "messages");
  clock = Date.UTC(2026, 10, 5, 0, 0, 1);
  c.add(-100, "messages");
  c.flush();
  expect(rows().map((r) => [r.day, r.messages])).toEqual([["2026-11-04", 1], ["2026-11-05", 1]]);
});

test("counts nothing in a chat with moderation and auto replies off, nor in an unknown chat", () => {
  const c = collector();
  c.add(-200, "messages"); c.add(-300, "messages");
  c.flush();
  expect(rows()).toEqual([]);
});

test("broadcasts count in any chat", () => {
  const c = collector();
  c.add(-200, "broadcasts");
  c.flush();
  expect(rows()[0]).toMatchObject({ chat_id: -200, broadcasts: 1 });
});

test("a chat deleted before the flush does not block the others", () => {
  const c = collector();
  c.add(-100, "messages");
  db.prepare("DELETE FROM chats WHERE id = -100").run();
  c.add(-200, "broadcasts");
  c.flush();
  expect(rows().map((r) => r.chat_id)).toEqual([-200]);
});

test("the stats survive a migration to a supergroup", () => {
  const c = collector();
  c.add(-100, "messages", 4);
  c.flush();
  migrateChatId(db, -100, -1000);
  expect(rows()[0]).toMatchObject({ chat_id: -1000, messages: 4 });
});

test("the table has a column for every field", () => {
  const cols = (db.prepare("PRAGMA table_info(chat_daily_stats)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const f of STAT_FIELDS) expect(cols).toContain(f);
});

// ---- counting points

const viol = (o: Partial<Violation> = {}): Violation => ({
  chatId: -100, sender: { type: "user", id: 10, name: "Ana" }, filter: "link", matched: "x.com", text: "hi",
  action: "delete_ban", messageIds: [7, 8], adminCheckUserId: 10, noticeTemplate: null, ...o,
});
function enforcerWith(appEnv: "production" | "development", member = "member") {
  const api = {
    getChat: vi.fn(async () => ({ id: -100, type: "supergroup", title: "A" })),
    getChatMember: vi.fn(async () => ({ status: member })),
    deleteMessages: vi.fn(async () => true), banChatMember: vi.fn(async () => true),
    banChatSenderChat: vi.fn(async () => true), sendMessage: vi.fn(async () => ({ message_id: 1 })),
  };
  const c = collector();
  const e = createEnforcer({ api: api as unknown as EnforcerApi, db, appEnv, stats: c, sleep: async () => {} });
  return { api, c, e };
}
const stored = () => rows()[0] as unknown as StatRow & Record<string, number>;

test("a filter hit counts its filter, the deleted messages and the ban", async () => {
  const { c, e } = enforcerWith("production");
  e.enqueue(viol({ filter: "word" }));
  await e.drain(); c.flush();
  expect(stored()).toMatchObject({ word_hits: 1, deleted: 2, banned: 1, link_hits: 0 });
});

test("each filter increments its own counter", async () => {
  const { c, e } = enforcerWith("production");
  for (const filter of ["link", "word", "flood", "bot"] as const) e.enqueue(viol({ filter }));
  await e.drain(); c.flush();
  expect(stored()).toMatchObject({ link_hits: 1, word_hits: 1, flood_hits: 1, bot_hits: 1 });
});

test("a simulated ban counts the hit and the deletion but not the ban", async () => {
  const { c, e } = enforcerWith("development");
  e.enqueue(viol());
  await e.drain(); c.flush();
  expect(stored()).toMatchObject({ link_hits: 1, deleted: 2, banned: 0 });
});

test("an exempt admin counts nothing", async () => {
  const { c, e } = enforcerWith("production", "administrator");
  e.enqueue(viol());
  await e.drain(); c.flush();
  expect(rows()).toEqual([]);
});

test("a failed delete or ban does not count as done", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { api, c, e } = enforcerWith("production");
  api.deleteMessages.mockRejectedValue(new Error("no rights"));
  api.banChatMember.mockRejectedValue(new Error("no rights"));
  e.enqueue(viol());
  await e.drain(); c.flush();
  expect(stored()).toMatchObject({ link_hits: 1, deleted: 0, banned: 0 });
  err.mockRestore();
});

test("the seen handler counts messages, joins and leaves, not service messages or bots", async () => {
  const c = collector();
  const t = createTestBot();
  t.bot.use(createSeenUsersHandler({ db, stats: c }));
  const ana = { id: 10, is_bot: false, first_name: "Ana" };
  const bot = { id: 11, is_bot: true, first_name: "Bot" };
  await t.bot.handleUpdate(groupMessage({ from: ana, chat: { id: -100, type: "supergroup", title: "On" } }));
  await t.bot.handleUpdate(groupMessage({ from: bot, chat: { id: -100, type: "supergroup", title: "On" } }));
  const chat = { id: -100, type: "supergroup", title: "On" } as const;
  await t.bot.handleUpdate(groupMessage({ from: ana, chat, text: undefined, new_chat_members: [ana, bot, { ...ana, id: 12 }] }));
  await t.bot.handleUpdate(groupMessage({ from: ana, chat, text: undefined, left_chat_member: ana }));
  await t.bot.handleUpdate(groupMessage({ from: ana, chat, text: undefined, new_chat_title: "x" } as never));
  await t.bot.handleUpdate(groupMessage({ from: ana, chat: { id: -200, type: "supergroup", title: "Off" } }));
  c.flush();
  expect(rows()).toHaveLength(1);
  expect(stored()).toMatchObject({ messages: 1, joins: 2, leaves: 1 });
});

test("an auto reply counts only when it is sent", async () => {
  insertAutoReply(db, -100, ["hello"], "Hi!", []);
  const c = collector();
  const t = createTestBot();
  t.bot.use(createAutoRepliesHandler({ db, stats: c }));
  await t.bot.handleUpdate(groupMessage({ text: "hello there", chat: { id: -100, type: "supergroup", title: "On" } }));
  await vi.waitFor(() => expect(t.callsOf("sendMessage")).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 5));
  c.flush();
  expect(stored()).toMatchObject({ auto_replies: 1 });

  t.respond("sendMessage", () => { throw new Error("blocked"); });
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  await t.bot.handleUpdate(groupMessage({ text: "hello again", chat: { id: -100, type: "supergroup", title: "On" } }));
  await new Promise((r) => setTimeout(r, 5));
  c.flush();
  err.mockRestore();
  expect(stored()).toMatchObject({ auto_replies: 1 });
});

test("a broadcast counts per sent target, even in a chat with everything off", async () => {
  const c = collector();
  const sendMessage = vi.fn(async (chatId: number) => { if (chatId === -300) throw new Error("x"); return { message_id: 1 }; });
  insertChat(db, { id: -300, type: "supergroup", title: "Bad", username: null }, []);
  const s = createScheduler({ api: { sendMessage } as unknown as SchedulerApi, db, now: () => Math.floor(clock / 1000), sleep: async () => {}, stats: c });
  createMessage(db, "Hi", [-100, -200, -300], Math.floor(clock / 1000));
  await s.tick();
  c.flush();
  expect(rows().map((r) => [r.chat_id, r.broadcasts])).toEqual([[-200, 1], [-100, 1]]);
  expect(rows().some((r) => r.chat_id === -300)).toBe(false);
});

test("an orderly shutdown saves the pending counts before the database closes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stats-"));
  try {
    const file = join(dir, "t.sqlite");
    const disk = openDatabase(file);
    insertChat(disk, { id: -100, type: "supergroup", title: "On", username: null }, []);
    updateChatSettings(disk, -100, { moderationEnabled: true });
    const c = createStatsCollector({ db: disk, now: () => clock });
    c.add(-100, "messages", 3);
    await runShutdown([["stats.stop", () => c.stop()], ["db.close", () => disk.close()]]);
    const again = openDatabase(file);
    expect(again.prepare("SELECT messages FROM chat_daily_stats").get()).toEqual({ messages: 3 });
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
