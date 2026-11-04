import type { Chat } from "grammy/types";
import { beforeEach, expect, test, vi } from "vitest";
import { insertAutoReply } from "../db/auto-replies.js";
import { insertChat, updateChatSettings } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { listEvents } from "../db/events.js";
import { addWord } from "../db/lists.js";
import { createEnforcer } from "../moderation/enforcer.js";
import { FloodTracker } from "../moderation/flood.js";
import { createModerationHandler } from "../moderation/handler.js";
import { createTestBot } from "../test/harness.js";
import { editedGroupMessage, groupMessage } from "../test/updates.js";
import { createAutoRepliesHandler } from "./auto-replies.js";
import { createRulesHandler } from "./rules.js";

const CHAT = -100;
let db: Db;
let t: ReturnType<typeof createTestBot>;
let enforcer: ReturnType<typeof createEnforcer>;
let clock: number;
let nextCalled: boolean;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  clock = 1_000_000;
  t = createTestBot();
  enforcer = createEnforcer({ api: t.bot.api, db, appEnv: "production" });
  nextCalled = false;
  t.bot.use(createModerationHandler({ db, enforcer, flood: new FloodTracker() }));
  t.bot.use(createRulesHandler({ db, now: () => clock }));
  t.bot.use(createAutoRepliesHandler({ db, now: () => clock }));
  t.bot.use((_ctx, next) => { nextCalled = true; return next(); });
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
const run = async (...updates: Parameters<typeof t.bot.handleUpdate>[0][]) => {
  for (const u of updates) await t.bot.handleUpdate(u);
  await enforcer.drain();
  await flush();
};
const rulesCommand = () => groupMessage({ text: "/rules", entities: [{ type: "bot_command", offset: 0, length: 6 }] });
const sent = () => t.callsOf("sendMessage").map((c) => c.payload);

test("/rules posts the group's rules as a reply, without a link preview", async () => {
  updateChatSettings(db, CHAT, { rules: "Be nice" });
  const update = rulesCommand();
  await run(update);
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toMatchObject({
    chat_id: CHAT, text: "Be nice",
    reply_parameters: { message_id: update.message!.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  });
  expect(nextCalled).toBe(false);
});

test("/rules with no rules set says nothing", async () => {
  await run(rulesCommand());
  expect(sent()).toHaveLength(0);
});

test("/rules answers at most once a minute per chat", async () => {
  updateChatSettings(db, CHAT, { rules: "Be nice" });
  await run(rulesCommand(), rulesCommand());
  expect(sent()).toHaveLength(1);
  clock += 59_999;
  await run(rulesCommand());
  expect(sent()).toHaveLength(1);
  clock += 1;
  await run(rulesCommand());
  expect(sent()).toHaveLength(2);
});

test("/rules with a link is moderated, not answered", async () => {
  updateChatSettings(db, CHAT, { rules: "Be nice", moderationEnabled: true });
  await run(groupMessage({
    text: "/rules a.example",
    entities: [{ type: "bot_command", offset: 0, length: 6 }, { type: "url", offset: 7, length: 9 }],
  }));
  expect(sent()).toHaveLength(0);
  expect(listEvents(db, CHAT, { limit: 5 })).toHaveLength(1);
});

test("a failed send is logged and does not break the update", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  t.respond("sendMessage", () => { throw new Error("down"); });
  updateChatSettings(db, CHAT, { rules: "Be nice", autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(rulesCommand(), groupMessage({ text: "premium" }));
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

test("sending never holds up the update queue", async () => {
  t.respond("sendMessage", () => new Promise(() => {}));
  updateChatSettings(db, CHAT, { rules: "Be nice", autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await t.bot.handleUpdate(rulesCommand());
  await t.bot.handleUpdate(groupMessage({ text: "premium" }));
  expect(nextCalled).toBe(true);
});

test("auto replies are off by default", async () => {
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(groupMessage({ text: "premium" }));
  expect(sent()).toHaveLength(0);
  expect(nextCalled).toBe(true);
});

test("a trigger answers as a reply, ignoring case and accents, and continues to next", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium", "informacion"], "Get premium: https://x.example");
  const update = groupMessage({ text: "quiero INFORMACIÓN ya" });
  await run(update);
  expect(sent()[0]).toMatchObject({
    chat_id: CHAT, text: "Get premium: https://x.example",
    reply_parameters: { message_id: update.message!.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  });
  expect(nextCalled).toBe(true);
});

test.each([
  ["a longer word", { text: "premiums" }],
  ["a mention", { text: "@premium hello", entities: [{ type: "mention" as const, offset: 0, length: 8 }] }],
  ["a url", { text: "x.example/premium", entities: [{ type: "url" as const, offset: 0, length: 17 }] }],
])("a trigger inside %s does not answer", async (_name, message) => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(groupMessage(message));
  expect(sent()).toHaveLength(0);
});

test("a styled reply is sent with its Telegram entities", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  const entities = [{ type: "bold" as const, offset: 0, length: 3 }, { type: "text_link" as const, offset: 4, length: 2, url: "https://x.example" }];
  insertAutoReply(db, CHAT, ["premium"], "Get it", entities);
  await run(groupMessage({ text: "premium" }));
  expect(sent()[0]).toMatchObject({ text: "Get it", entities });
  expect(sent()[0].parse_mode).toBeUndefined();
});

test("a plain reply sends no entities field", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(groupMessage({ text: "premium" }));
  expect(sent()[0]).not.toHaveProperty("entities");
});

test("a trigger in a photo caption answers", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(groupMessage({ text: undefined, caption: "premium?" }));
  expect(sent()).toHaveLength(1);
});

test("each reply goes out at most once a minute per chat; other replies are not blocked", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  insertAutoReply(db, CHAT, ["help"], "Ask");
  await run(groupMessage({ text: "premium" }), groupMessage({ text: "premium" }), groupMessage({ text: "help" }));
  expect(sent().map((m) => m.text)).toEqual(["Info", "Ask"]);
  clock += 60_000;
  await run(groupMessage({ text: "premium" }));
  expect(sent().map((m) => m.text)).toEqual(["Info", "Ask", "Info"]);
});

test("one message answers once even if it matches several replies", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  insertAutoReply(db, CHAT, ["help"], "Ask");
  await run(groupMessage({ text: "premium help" }));
  expect(sent().map((m) => m.text)).toEqual(["Info"]);
});

test("edited messages and channel auto-forwards do not answer", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(editedGroupMessage({ text: "premium" }), groupMessage({ text: "premium", is_automatic_forward: true }));
  expect(sent()).toHaveLength(0);
});

test("moderation goes first: a banned message is sanctioned and not answered", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true, moderationEnabled: true });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  addWord(db, CHAT, "spam");
  await run(groupMessage({ text: "premium spam" }));
  expect(sent()).toHaveLength(0);
  expect(listEvents(db, CHAT, { limit: 5 })[0]).toMatchObject({ filter: "word" });
});

test("auto replies work with moderation switched off", async () => {
  updateChatSettings(db, CHAT, { autoRepliesEnabled: true, moderationEnabled: false });
  insertAutoReply(db, CHAT, ["premium"], "Info");
  await run(groupMessage({ text: "premium" }));
  expect(sent()).toHaveLength(1);
});

test("private chats never answer, even with a matching id", async () => {
  const chat: Chat = { id: 10, type: "private", first_name: "Ana" };
  insertChat(db, { id: 10, type: "group", title: "Fake", username: null }, []);
  updateChatSettings(db, 10, { autoRepliesEnabled: true, rules: "Be nice" });
  insertAutoReply(db, 10, ["premium"], "Info");
  await run(
    groupMessage({ chat, text: "premium" }),
    groupMessage({ chat, text: "/rules", entities: [{ type: "bot_command", offset: 0, length: 6 }] }),
  );
  expect(sent()).toHaveLength(0);
});
