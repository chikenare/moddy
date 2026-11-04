import { beforeEach, expect, test } from "vitest";
import { deleteAutoReply, getAutoReply, insertAutoReply, listAutoReplies, updateAutoReply } from "./auto-replies.js";
import { deleteChat, insertChat, migrateChatId } from "./chats.js";
import { type Db, openDatabase } from "./connection.js";

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  for (const id of [-1, -2]) insertChat(db, { id, type: "supergroup", title: "G", username: null }, []);
});

test("stores several triggers per reply, in creation order and per chat", () => {
  const a = insertAutoReply(db, -1, ["premium", "vip"], "Get premium");
  const b = insertAutoReply(db, -1, ["help"], "Ask an admin");
  insertAutoReply(db, -2, ["other"], "Other chat");
  expect(a).toMatchObject({ chatId: -1, triggers: ["premium", "vip"], reply: "Get premium" });
  expect(listAutoReplies(db, -1).map((r) => r.id)).toEqual([a.id, b.id]);
  expect(listAutoReplies(db, -2)).toHaveLength(1);
});

test("styles are stored with the text; plain replies have none", () => {
  const bold = { type: "bold" as const, offset: 0, length: 3 };
  const styled = insertAutoReply(db, -1, ["premium"], "Get it", [bold]);
  expect(getAutoReply(db, -1, styled.id)!.entities).toEqual([bold]);
  const link = { type: "text_link" as const, offset: 0, length: 3, url: "https://x.example" };
  expect(updateAutoReply(db, -1, styled.id, ["premium"], "New", [link])!.entities).toEqual([link]);
  expect(insertAutoReply(db, -1, ["vip"], "Plain").entities).toEqual([]);
});

test("update changes triggers and text, only within its chat", () => {
  const a = insertAutoReply(db, -1, ["premium"], "Old");
  expect(updateAutoReply(db, -2, a.id, ["x1"], "Nope")).toBeUndefined();
  expect(updateAutoReply(db, -1, a.id, ["vip"], "New")).toMatchObject({ triggers: ["vip"], reply: "New" });
  expect(getAutoReply(db, -1, a.id)).toMatchObject({ triggers: ["vip"], reply: "New" });
});

test("delete reports whether it existed, only within its chat", () => {
  const a = insertAutoReply(db, -1, ["premium"], "Old");
  expect(deleteAutoReply(db, -2, a.id)).toBe(false);
  expect(deleteAutoReply(db, -1, a.id)).toBe(true);
  expect(deleteAutoReply(db, -1, a.id)).toBe(false);
});

test("auto replies follow a supergroup migration and go away with the chat", () => {
  insertAutoReply(db, -1, ["premium"], "Old");
  migrateChatId(db, -1, -1001);
  expect(listAutoReplies(db, -1001)).toHaveLength(1);
  deleteChat(db, -1001);
  expect(listAutoReplies(db, -1001)).toEqual([]);
});
