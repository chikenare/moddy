import { beforeEach, expect, test } from "vitest";
import { deleteChat, insertChat, migrateChatId } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { cancelMessage, createMessage, getMessage, listMessages, purgeMessages } from "./messages.js";

const DAY = 86_400;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  for (const id of [-1, -2]) insertChat(db, { id, type: "supergroup", title: `Chat ${id}`, username: null }, []);
});

test("a new message has one pending target per chat, with its title", () => {
  const m = createMessage(db, "Hello", [-1, -2], 500, 100);
  expect(m).toMatchObject({ text: "Hello", sendAt: 500, createdAt: 100 });
  expect(m.targets).toEqual([
    { chatId: -2, title: "Chat -2", status: "pending", error: null, sentAt: null },
    { chatId: -1, title: "Chat -1", status: "pending", error: null, sentAt: null },
  ]);
});

test("list shows the newest first, limited", () => {
  const a = createMessage(db, "A", [-1], 500);
  const b = createMessage(db, "B", [-1], 400);
  db.prepare("UPDATE scheduled_message_targets SET status = 'sent'").run();
  expect(listMessages(db).map((m) => m.id)).toEqual([b.id, a.id]);
  expect(listMessages(db, 1)).toHaveLength(1);
});

test("an old pending message stays listed, first, however many newer finished ones exist", () => {
  const old = createMessage(db, "Later", [-1], 9_999);
  for (let i = 0; i < 150; i++) {
    const m = createMessage(db, `Done ${i}`, [-1], 100 + i);
    db.prepare("UPDATE scheduled_message_targets SET status = 'sent' WHERE message_id = ?").run(m.id);
  }
  const list = listMessages(db, 100);
  expect(list).toHaveLength(101);
  expect(list[0]!.id).toBe(old.id);
  expect(list[1]!.text).toBe("Done 149");
});

test("cancel only touches targets still pending and reports how many", () => {
  const m = createMessage(db, "A", [-1, -2], 500);
  db.prepare("UPDATE scheduled_message_targets SET status = 'sent' WHERE chat_id = -1").run();
  expect(cancelMessage(db, m.id)).toBe(1);
  expect(cancelMessage(db, m.id)).toBe(0);
  const byChat = Object.fromEntries(getMessage(db, m.id)!.targets.map((t) => [t.chatId, t.status]));
  expect(byChat).toEqual({ "-1": "sent", "-2": "cancelled" });
});

test("a pending message follows a supergroup migration", () => {
  const m = createMessage(db, "A", [-1], 500);
  migrateChatId(db, -1, -1001);
  expect(getMessage(db, m.id)!.targets[0]!.chatId).toBe(-1001);
});

test("a forgotten chat leaves its target; a message with no targets disappears from the list", () => {
  const m = createMessage(db, "A", [-1, -2], 500);
  deleteChat(db, -1);
  expect(getMessage(db, m.id)!.targets.map((t) => t.chatId)).toEqual([-2]);
  deleteChat(db, -2);
  expect(listMessages(db)).toEqual([]);
});

test("purge removes finished messages after 90 days and keeps pending ones", () => {
  const now = 200 * DAY;
  const oldDone = createMessage(db, "Old", [-1], now - 91 * DAY);
  db.prepare("UPDATE scheduled_message_targets SET status = 'sent' WHERE message_id = ?").run(oldDone.id);
  const oldPending = createMessage(db, "Stuck", [-1], now - 91 * DAY);
  const recent = createMessage(db, "Recent", [-1], now - 89 * DAY);
  db.prepare("UPDATE scheduled_message_targets SET status = 'sent' WHERE message_id = ?").run(recent.id);
  const orphan = createMessage(db, "Orphan", [-2], now);
  deleteChat(db, -2);

  expect(purgeMessages(db, now)).toBe(2);
  expect(getMessage(db, oldDone.id)).toBeUndefined();
  expect(getMessage(db, orphan.id)).toBeUndefined();
  expect(getMessage(db, oldPending.id)).toBeDefined();
  expect(getMessage(db, recent.id)).toBeDefined();
});
