import { beforeEach, expect, test } from "vitest";
import { insertChat, updateChatSettings } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { findSeenUser } from "../db/staff.js";
import { createTestBot } from "../test/harness.js";
import { editedGroupMessage, groupMessage } from "../test/updates.js";
import { createSeenUsersHandler } from "./seen.js";

const CHAT = -100;
const JUAN = { id: 20, is_bot: false, first_name: "Juan", last_name: "Pérez", username: "JuanP" };
let db: Db;
let t: ReturnType<typeof createTestBot>;
let nextCalled: boolean;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  t = createTestBot();
  nextCalled = false;
  t.bot.use(createSeenUsersHandler({ db }));
  t.bot.use((_ctx, next) => { nextCalled = true; return next(); });
});

test("remembers who writes in a chat with moderation on, and continues", async () => {
  updateChatSettings(db, CHAT, { moderationEnabled: true });
  await t.bot.handleUpdate(groupMessage({ from: JUAN }));
  expect(findSeenUser(db, CHAT, "juanp")).toMatchObject({ userId: 20, displayName: "Juan Pérez" });
  expect(nextCalled).toBe(true);
});

test("remembers who writes in a chat with auto replies on", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  await t.bot.handleUpdate(groupMessage({ from: JUAN }));
  expect(findSeenUser(db, CHAT, "juanp")?.userId).toBe(20);
});

test("stores nothing about a chat with everything switched off", async () => {
  await t.bot.handleUpdate(groupMessage({ from: JUAN }));
  expect(findSeenUser(db, CHAT, "juanp")).toBeUndefined();
  expect(nextCalled).toBe(true);
});

test.each([
  ["a channel sender", { from: JUAN, sender_chat: { id: -5, type: "channel" as const, title: "C" } }],
  ["a bot", { from: { ...JUAN, is_bot: true } }],
])("ignores %s", async (_name, message) => {
  updateChatSettings(db, CHAT, { moderationEnabled: true });
  await t.bot.handleUpdate(groupMessage(message));
  expect(findSeenUser(db, CHAT, "juanp")).toBeUndefined();
});

test("ignores edits", async () => {
  updateChatSettings(db, CHAT, { moderationEnabled: true });
  await t.bot.handleUpdate(editedGroupMessage({ from: JUAN }));
  expect(findSeenUser(db, CHAT, "juanp")).toBeUndefined();
});

test("remembers users with no username, findable only by id", async () => {
  updateChatSettings(db, CHAT, { moderationEnabled: true });
  await t.bot.handleUpdate(groupMessage({ from: { id: 21, is_bot: false, first_name: "Bea" } }));
  const row = db.prepare("SELECT user_id, username, display_name FROM chat_seen_users WHERE chat_id = ?").get(CHAT);
  expect(row).toEqual({ user_id: 21, username: null, display_name: "Bea" });
});
