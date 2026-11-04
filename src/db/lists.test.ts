import { expect, test } from "vitest";
import { insertChat } from "./chats.js";
import { openDatabase } from "./connection.js";
import { addWhitelistEntry, addWord, listWhitelist, listWords, removeWhitelistEntry, removeWord } from "./lists.js";

test("addWord y addWhitelistEntry son idempotentes; remove indica si existía", () => {
  const db = openDatabase(":memory:");
  insertChat(db, { id: 1, type: "group", title: "A", username: null }, []);
  addWord(db, 1, "spam");
  addWord(db, 1, "spam");
  expect(listWords(db, 1)).toEqual(["spam"]);
  expect(removeWord(db, 1, "spam")).toBe(true);
  expect(removeWord(db, 1, "spam")).toBe(false);
  addWhitelistEntry(db, 1, "a.com");
  addWhitelistEntry(db, 1, "a.com");
  expect(listWhitelist(db, 1)).toEqual(["a.com"]);
  expect(removeWhitelistEntry(db, 1, "a.com")).toBe(true);
  expect(removeWhitelistEntry(db, 1, "a.com")).toBe(false);
});
