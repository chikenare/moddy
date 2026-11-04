import { beforeEach, expect, test } from "vitest";
import { insertChat } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { createMessage, listMessages } from "./messages.js";
import { createRecurring, deleteRecurring, dueRecurring, fireRecurring, getRecurring, listRecurring, setRecurringEnabled, updateRecurring } from "./recurring.js";

let db: Db;
const input = (o = {}) => ({
  text: "Daily", entities: [{ type: "bold" as const, offset: 0, length: 5 }], cron: "0 9 * * *", timezone: "UTC",
  chatIds: [-1, -2], nextRunAt: 1000, ...o,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  for (const id of [-1, -2, -3]) insertChat(db, { id, type: "supergroup", title: `Chat ${id}`, username: null }, []);
});

test("create stores the rule with its chats, formatting and next run", () => {
  const r = createRecurring(db, input(), 10);
  expect(r).toMatchObject({
    text: "Daily", cron: "0 9 * * *", timezone: "UTC", enabled: true, nextRunAt: 1000, lastRunAt: null, createdAt: 10,
    entities: [{ type: "bold", offset: 0, length: 5 }],
    chats: [{ id: -1, title: "Chat -1" }, { id: -2, title: "Chat -2" }],
  });
  expect(getRecurring(db, r.id)).toEqual(r);
  expect(listRecurring(db)).toEqual([r]);
});

test("update replaces text, schedule and chats", () => {
  const r = createRecurring(db, input());
  const u = updateRecurring(db, r.id, input({ text: "New", cron: "0 8 * * 1", chatIds: [-3], nextRunAt: 5000 }))!;
  expect(u).toMatchObject({ text: "New", cron: "0 8 * * 1", nextRunAt: 5000, chats: [{ id: -3 }] });
  expect(updateRecurring(db, 999, input())).toBeUndefined();
});

test("pausing clears the next run and resuming sets it", () => {
  const r = createRecurring(db, input());
  expect(setRecurringEnabled(db, r.id, false, null)).toMatchObject({ enabled: false, nextRunAt: null });
  expect(dueRecurring(db, 99999)).toEqual([]);
  expect(setRecurringEnabled(db, r.id, true, 7000)).toMatchObject({ enabled: true, nextRunAt: 7000 });
});

test("due rules are the enabled ones whose next run has come", () => {
  const a = createRecurring(db, input({ nextRunAt: 1000 }));
  createRecurring(db, input({ nextRunAt: 2000 }));
  const paused = createRecurring(db, input({ nextRunAt: 500 }));
  setRecurringEnabled(db, paused.id, false, 500);
  expect(dueRecurring(db, 1500).map((r) => r.id)).toEqual([a.id]);
});

test("deleting a rule keeps the messages it already produced", () => {
  const r = createRecurring(db, input());
  fireRecurring(db, r, { sendAt: 1000, nextRunAt: 2000 }, 1000);
  expect(listMessages(db)).toHaveLength(1);
  expect(deleteRecurring(db, r.id)).toBe(true);
  expect(deleteRecurring(db, r.id)).toBe(false);
  expect(listMessages(db)).toMatchObject([{ text: "Daily", recurringId: null }]);
});

test("firing creates the message and advances the rule together", () => {
  const r = createRecurring(db, input());
  expect(fireRecurring(db, r, { sendAt: 1000, nextRunAt: 2000 }, 1005)).toBe(true);
  expect(listMessages(db)).toMatchObject([{
    text: "Daily", sendAt: 1000, recurringId: r.id, entities: [{ type: "bold" }],
    targets: [{ chatId: -2, status: "pending" }, { chatId: -1, status: "pending" }],
  }]);
  expect(getRecurring(db, r.id)).toMatchObject({ nextRunAt: 2000, lastRunAt: 1000 });
});

test("firing again from a stale copy does nothing", () => {
  const r = createRecurring(db, input());
  fireRecurring(db, r, { sendAt: 1000, nextRunAt: 2000 }, 1005);
  expect(fireRecurring(db, r, { sendAt: 1000, nextRunAt: 2000 }, 1005)).toBe(false);
  expect(listMessages(db)).toHaveLength(1);
});

test("firing with no message only advances the rule, and null next run disables it", () => {
  const r = createRecurring(db, input());
  fireRecurring(db, r, { sendAt: null, nextRunAt: null }, 1005);
  expect(listMessages(db)).toHaveLength(0);
  expect(getRecurring(db, r.id)).toMatchObject({ enabled: false, nextRunAt: null, lastRunAt: null });
});

test("a one-off message has no rule", () => {
  expect(createMessage(db, "x", [-1], 1)).toMatchObject({ recurringId: null, entities: [] });
});
