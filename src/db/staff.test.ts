import { beforeEach, expect, test } from "vitest";
import { deleteChat, insertChat, migrateChatId } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { addStaff, findSeenUser, isStaff, listStaff, purgeSeenUsers, recordSeenUser, removeStaff } from "./staff.js";

const DAY = 86_400;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  for (const id of [-1, -2]) insertChat(db, { id, type: "supergroup", title: "G", username: null }, []);
});

test("staff is per chat, adding twice keeps one row, and removal reports whether it existed", () => {
  addStaff(db, -1, 10, "Ana", 100);
  addStaff(db, -1, 10, "Ana Ruiz", 200);
  expect(listStaff(db, -1)).toEqual([{ userId: 10, displayName: "Ana Ruiz", addedAt: 100 }]);
  expect(isStaff(db, -1, 10)).toBe(true);
  expect(isStaff(db, -2, 10)).toBe(false);
  expect(removeStaff(db, -1, 10)).toBe(true);
  expect(removeStaff(db, -1, 10)).toBe(false);
  expect(isStaff(db, -1, 10)).toBe(false);
});

test("seen users are found by username ignoring case and per chat", () => {
  recordSeenUser(db, -1, { id: 10, username: "JuanP", displayName: "Juan" }, 100);
  expect(findSeenUser(db, -1, "juanp")).toEqual({ userId: 10, username: "juanp", displayName: "Juan", seenAt: 100 });
  expect(findSeenUser(db, -1, "JUANP")?.userId).toBe(10);
  expect(findSeenUser(db, -2, "juanp")).toBeUndefined();
});

test("seeing a user again updates their username and name", () => {
  recordSeenUser(db, -1, { id: 10, username: "old", displayName: "Old" }, 100);
  recordSeenUser(db, -1, { id: 10, username: "new", displayName: "New" }, 200);
  expect(findSeenUser(db, -1, "old")).toBeUndefined();
  expect(findSeenUser(db, -1, "new")).toMatchObject({ userId: 10, displayName: "New", seenAt: 200 });
});

test("a username that moved to another account resolves to the most recent one", () => {
  recordSeenUser(db, -1, { id: 10, username: "shared", displayName: "First" }, 100);
  recordSeenUser(db, -1, { id: 11, username: "shared", displayName: "Second" }, 200);
  expect(findSeenUser(db, -1, "shared")?.userId).toBe(11);
});

test("purge removes users not seen for 90 days and keeps staff", () => {
  const now = 200 * DAY;
  recordSeenUser(db, -1, { id: 10, username: "old", displayName: "Old" }, now - 91 * DAY);
  recordSeenUser(db, -1, { id: 11, username: "new", displayName: "New" }, now - 89 * DAY);
  addStaff(db, -1, 10, "Old", now - 91 * DAY);
  expect(purgeSeenUsers(db, now)).toBe(1);
  expect(findSeenUser(db, -1, "old")).toBeUndefined();
  expect(findSeenUser(db, -1, "new")?.userId).toBe(11);
  expect(isStaff(db, -1, 10)).toBe(true);
});

test("staff and seen users follow a supergroup migration and go away with the chat", () => {
  addStaff(db, -1, 10, "Ana", 100);
  recordSeenUser(db, -1, { id: 10, username: "ana", displayName: "Ana" }, 100);
  migrateChatId(db, -1, -1001);
  expect(isStaff(db, -1001, 10)).toBe(true);
  expect(findSeenUser(db, -1001, "ana")?.userId).toBe(10);
  deleteChat(db, -1001);
  expect(listStaff(db, -1001)).toEqual([]);
  expect(findSeenUser(db, -1001, "ana")).toBeUndefined();
});
