import { beforeEach, expect, test } from "vitest";
import { insertChat, migrateChatId } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";
import { addWarning, clearWarnings, countWarnings, purgeWarnings } from "./warnings.js";

const CHAT = -100;
const NOW = 1_000_000;
const DAY = 86_400;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  insertChat(db, { id: -200, type: "supergroup", title: "Otro", username: null }, []);
});

test("adding returns how many are active, per person and per group", () => {
  expect(addWarning(db, CHAT, 20, "one", NOW)).toBe(1);
  expect(addWarning(db, CHAT, 20, null, NOW)).toBe(2);
  expect(addWarning(db, CHAT, 30, null, NOW)).toBe(1);
  expect(addWarning(db, -200, 20, null, NOW)).toBe(1);
  expect(countWarnings(db, CHAT, 20, NOW)).toBe(2);
});

test("a warning stops counting after 30 days", () => {
  addWarning(db, CHAT, 20, null, NOW);
  expect(countWarnings(db, CHAT, 20, NOW + 30 * DAY - 1)).toBe(1);
  expect(countWarnings(db, CHAT, 20, NOW + 30 * DAY)).toBe(0);
  expect(addWarning(db, CHAT, 20, null, NOW + 30 * DAY)).toBe(1);
});

test("clearing affects one person in one group", () => {
  addWarning(db, CHAT, 20, null, NOW);
  addWarning(db, CHAT, 30, null, NOW);
  addWarning(db, -200, 20, null, NOW);
  clearWarnings(db, CHAT, 20);
  expect(countWarnings(db, CHAT, 20, NOW)).toBe(0);
  expect(countWarnings(db, CHAT, 30, NOW)).toBe(1);
  expect(countWarnings(db, -200, 20, NOW)).toBe(1);
});

test("purge removes only expired warnings", () => {
  addWarning(db, CHAT, 20, null, NOW);
  addWarning(db, CHAT, 30, null, NOW + DAY);
  expect(purgeWarnings(db, NOW + 30 * DAY)).toBe(1);
  expect(countWarnings(db, CHAT, 30, NOW + DAY)).toBe(1);
});

test("warnings follow a group that migrates to a supergroup, and go with a forgotten group", () => {
  addWarning(db, -200, 20, null, NOW);
  migrateChatId(db, -200, -300);
  expect(countWarnings(db, -300, 20, NOW)).toBe(1);
  db.prepare("DELETE FROM chats WHERE id = -300").run();
  expect(db.prepare("SELECT count(*) FROM chat_warnings").pluck().get()).toBe(0);
});
