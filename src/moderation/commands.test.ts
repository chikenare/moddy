import { beforeEach, expect, test, vi } from "vitest";
import type { Chat, Message, MessageEntity, User } from "grammy/types";
import { type Db, openDatabase } from "../db/connection.js";
import { getChat, insertChat, updateChatInfo, updateChatSettings } from "../db/chats.js";
import { type EventRecord, insertEvent, listEvents } from "../db/events.js";
import { addStaff, recordSeenUser } from "../db/staff.js";
import { addWarning, countWarnings } from "../db/warnings.js";
import type { AppEnv } from "../env.js";
import { createTestBot } from "../test/harness.js";
import { editedGroupMessage, groupMessage } from "../test/updates.js";
import { createCommandsHandler } from "./commands.js";
import { createEnforcer } from "./enforcer.js";

const CHAT = -100;
const ANA: User = { id: 10, is_bot: false, first_name: "Ana" };
const PEPE: User = { id: 20, is_bot: false, first_name: "Pepe" };
const CHANNEL: Chat = { id: -500, type: "channel", title: "Canal" };
const GROUP: Chat = { id: CHAT, type: "supergroup", title: "Grupo" };
const START_MS = 1_000_000_000_000;
const DAY_MS = 86_400_000;

let db: Db;
let t: ReturnType<typeof createTestBot>;
let enforcer: ReturnType<typeof createEnforcer>;
let clock: number;
let nextCalled: boolean;
let members: Record<number, unknown>;

function setup(appEnv: AppEnv = "production") {
  t = createTestBot();
  t.respond("getChatMember", (p) => members[p.user_id] ?? { status: "member", user: { id: p.user_id, is_bot: false, first_name: "x" } });
  t.respond("sendMessage", (p) => ({ message_id: 9000, date: 0, chat: { id: p.chat_id, type: "supergroup" }, text: p.text }));
  enforcer = createEnforcer({ api: t.bot.api, db, appEnv, now: () => clock });
  t.bot.use(createCommandsHandler({ api: t.bot.api, db, appEnv, queue: enforcer, now: () => clock }));
  t.bot.use((_ctx, next) => { nextCalled = true; return next(); });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  updateChatSettings(db, CHAT, { commandsEnabled: true });
  clock = START_MS;
  nextCalled = false;
  members = { 10: { status: "creator", user: ANA, is_anonymous: false } };
  setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const command = (text: string, overrides: Partial<Message> = {}, entities: MessageEntity[] = []) => groupMessage({
  text,
  from: ANA,
  entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }, ...entities],
  ...overrides,
} as Partial<Message>);
const replyTo = (from: User = PEPE, overrides: Partial<Message> = {}) =>
  ({ message_id: 700, date: 0, chat: GROUP, from, text: "buy my stuff", ...overrides }) as NonNullable<Message["reply_to_message"]>;
const run = async (...updates: Parameters<typeof t.bot.handleUpdate>[0][]) => {
  for (const u of updates) await t.bot.handleUpdate(u);
  await enforcer.drain();
};
const events = (): EventRecord[] => listEvents(db, CHAT, { limit: 50 });
const sent = () => t.callsOf("sendMessage").map((c) => c.payload.text as string);
const banned = () => t.callsOf("banChatMember").map((c) => c.payload.user_id as number);
const deleted = () => t.callsOf("deleteMessages").flatMap((c) => c.payload.message_ids as number[]);
const commandId = (u: ReturnType<typeof command>) => u.message!.message_id;

test("with commands off nothing happens, and the message moves on", async () => {
  updateChatSettings(db, CHAT, { commandsEnabled: false });
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(t.calls).toEqual([]);
  expect(nextCalled).toBe(true);
});

test("a chat the bot does not know moves on", async () => {
  await run(command("/ban", { chat: { id: -999, type: "supergroup", title: "Otro" } as Chat }));
  expect(t.calls).toEqual([]);
  expect(nextCalled).toBe(true);
});

test("the creator bans by replying: deletes the comment and the command, and records who did it and why", async () => {
  const update = command("/ban spam links", { reply_to_message: replyTo() });
  await run(update);
  expect(banned()).toEqual([20]);
  expect(deleted().sort()).toEqual([700, commandId(update)].sort());
  expect(nextCalled).toBe(false);
  expect(sent()).toEqual(["Banned Pepe. Reason: spam links"]);
  const [event] = events();
  expect(event).toMatchObject({
    senderId: 20, senderName: "Pepe", senderType: "user", filter: "command", action: "delete_ban",
    matched: "/ban by Ana: spam links", text: "buy my stuff", banOk: true, deleteOk: true, dryRun: false,
  });
});

test("an admin with the ban permission can use it", async () => {
  members[10] = { status: "administrator", user: ANA, can_restrict_members: true };
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);
});

test("an admin without the ban permission is told so, and is not warned", async () => {
  members[10] = { status: "administrator", user: ANA, can_restrict_members: false };
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(deleted()).toEqual([]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
  expect(sent()).toEqual(["You need the permission to ban users in this group."]);
});

test("someone on the staff list can use it without being an admin", async () => {
  members[10] = { status: "member", user: ANA };
  addStaff(db, CHAT, 10, "Ana");
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);
  expect(t.callsOf("getChatMember").map((c) => c.payload.user_id)).toEqual([20]);
});

test("an anonymous admin can use it", async () => {
  const update = command("/ban", { reply_to_message: replyTo(), sender_chat: GROUP, from: { id: 1087968824, is_bot: true, first_name: "Group" } });
  await run(update);
  expect(banned()).toEqual([20]);
  expect(events()[0]!.matched).toBe("/ban by anonymous admin");
});

test.each([
  ["another channel", CHANNEL],
  ["the linked channel", { ...CHANNEL, id: -600 } as Chat],
])("someone posting as %s moves on to the filters, unwarned", async (_name, senderChat) => {
  updateChatInfo(db, CHAT, { linkedChatId: -600 });
  await run(command("/ban", { reply_to_message: replyTo(), sender_chat: senderChat }));
  expect(t.calls).toEqual([]);
  expect(nextCalled).toBe(true);
});

test("if the bot cannot check who asked, it does nothing and punishes nobody", async () => {
  t.respond("getChatMember", () => { throw new Error("network"); });
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(deleted()).toEqual([]);
  expect(sent()).toEqual([]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
});

test.each(["ban", "unban", "warn"])("a normal member using /%s loses the command and gets a warning, and the target is untouched", async (name) => {
  members[10] = { status: "member", user: ANA };
  const update = command(`/${name}`, { reply_to_message: replyTo() });
  await run(update);
  expect(banned()).toEqual([]);
  expect(t.callsOf("unbanChatMember")).toEqual([]);
  expect(deleted()).toEqual([commandId(update)]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(1);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(0);
  expect(sent()).toEqual([`Ana, only admins and staff can use /${name}. Warning 1/3.`]);
  expect(events()[0]).toMatchObject({ senderId: 10, filter: "command", action: "warn", matched: `Tried /${name} without permission (1/3)`, banOk: null });
  expect(nextCalled).toBe(false);
});

test("notices are limited to one every 10 seconds per group, but every attempt counts", async () => {
  members[10] = { status: "member", user: ANA };
  await run(command("/ban"), command("/ban"));
  expect(sent()).toHaveLength(1);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(2);
  clock += 10_000;
  await run(command("/warn"));
  expect(sent()).toHaveLength(2);
});

test("reaching the limit bans a member who keeps trying, and starts them from zero", async () => {
  members[10] = { status: "member", user: ANA };
  await run(command("/ban"), command("/ban"), command("/ban"));
  expect(banned()).toEqual([10]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
  expect(events()[0]).toMatchObject({ senderId: 10, action: "delete_ban", banOk: true, matched: "Tried /ban without permission (3/3)" });
});

test("the limit is set per group", async () => {
  members[10] = { status: "member", user: ANA };
  updateChatSettings(db, CHAT, { warnLimit: 1 });
  await run(command("/ban"));
  expect(banned()).toEqual([10]);
  expect(sent()).toEqual(["Ana reached 1/1 warnings and was banned."]);
});

test("warnings expire after 30 days", async () => {
  members[10] = { status: "member", user: ANA };
  await run(command("/ban"), command("/ban"));
  clock += 30 * DAY_MS;
  await run(command("/ban"));
  expect(banned()).toEqual([]);
  expect(countWarnings(db, CHAT, 10, clock / 1000)).toBe(1);
});

test("warnings in another group do not count here", async () => {
  insertChat(db, { id: -300, type: "supergroup", title: "Otro", username: null }, []);
  addWarning(db, -300, 20, null, START_MS / 1000);
  await run(command("/warn", { reply_to_message: replyTo() }));
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(1);
  expect(countWarnings(db, -300, 20, START_MS / 1000)).toBe(1);
});

test("/ban @user finds someone the bot has seen", async () => {
  recordSeenUser(db, CHAT, { id: 20, username: "pepe", displayName: "Pepe" });
  const update = command("/ban @Pepe spam", {}, [{ type: "mention", offset: 5, length: 5 }]);
  await run(update);
  expect(banned()).toEqual([20]);
  expect(deleted()).toEqual([commandId(update)]);
  expect(sent()).toEqual(["Banned Pepe. Reason: spam"]);
});

test("/ban @user explains when the bot has never seen them", async () => {
  await run(command("/ban @ghost", {}, [{ type: "mention", offset: 5, length: 6 }]));
  expect(banned()).toEqual([]);
  expect(sent()).toEqual(["I haven't seen @ghost in this group. Reply to one of their messages, or use their numeric ID."]);
});

test("a mention with no username points straight at the user", async () => {
  await run(command("/ban Pepe spam", {}, [{ type: "text_mention", offset: 5, length: 4, user: PEPE }]));
  expect(banned()).toEqual([20]);
  expect(sent()).toEqual(["Banned Pepe. Reason: spam"]);
});

test("/ban with a numeric ID", async () => {
  await run(command("/ban 20 spam"));
  expect(banned()).toEqual([20]);
  expect(events()[0]).toMatchObject({ senderId: 20, senderName: "20", matched: "/ban by Ana: spam" });
});

test("a name typed in the command beats the reply, and the replied comment stays", async () => {
  recordSeenUser(db, CHAT, { id: 30, username: "luis", displayName: "Luis" });
  const update = command("/ban @luis", { reply_to_message: replyTo() }, [{ type: "mention", offset: 5, length: 5 }]);
  await run(update);
  expect(banned()).toEqual([30]);
  expect(deleted()).toEqual([commandId(update)]);
});

test("in a reply a number is part of the reason", async () => {
  await run(command("/ban 5 links", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);
  expect(sent()).toEqual(["Banned Pepe. Reason: 5 links"]);
});

test("the automatic reply to a forum topic's first message is not a target", async () => {
  await run(command("/ban", { is_topic_message: true, message_thread_id: 700, reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  const [payload] = t.callsOf("sendMessage").map((c) => c.payload);
  expect(payload.text).toContain("Reply to a message");
  expect(payload.message_thread_id).toBe(700);
});

test("without a target it explains how to use the command", async () => {
  await run(command("/warn"));
  expect(sent()).toEqual(["Reply to a message with /warn, or use /warn @user or /warn 12345. You can add a reason after it."]);
});

test.each([
  ["an admin", 20, { status: "administrator", user: PEPE }, "Pepe is an admin."],
  ["the creator", 20, { status: "creator", user: PEPE }, "Pepe is an admin."],
])("/ban refuses %s", async (_name, id, member, message) => {
  members[id] = member;
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(deleted()).toEqual([]);
  expect(sent()).toEqual([message]);
  expect(events()).toEqual([]);
});

test.each(["ban", "warn"])("/%s refuses staff, the sender, the bot and Telegram's own accounts", async (name) => {
  addStaff(db, CHAT, 20, "Pepe");
  await run(
    command(`/${name}`, { reply_to_message: replyTo() }),
    command(`/${name}`, { reply_to_message: replyTo(ANA) }),
    command(`/${name}`, { reply_to_message: replyTo({ id: 999, is_bot: true, first_name: "Test" }) }),
    command(`/${name}`, { reply_to_message: replyTo({ id: 777000, is_bot: false, first_name: "Telegram" }) }),
  );
  expect(banned()).toEqual([]);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(0);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
  expect(sent()).toEqual([
    "Pepe is on the staff list.", "You can't do that to yourself.", "I can't do that to myself.", "That is a Telegram account.",
  ]);
});

test("/ban refuses an anonymous admin and the linked channel", async () => {
  updateChatInfo(db, CHAT, { linkedChatId: -600 });
  await run(
    command("/ban", { reply_to_message: replyTo(ANA, { sender_chat: GROUP }) }),
    command("/ban", { reply_to_message: replyTo(ANA, { sender_chat: { ...CHANNEL, id: -600 } as Chat }) }),
  );
  expect(banned()).toEqual([]);
  expect(t.callsOf("banChatSenderChat")).toEqual([]);
  expect(sent()).toEqual(["That is an anonymous admin.", "That is this group's linked channel."]);
});

test("/ban asks Telegram whether a channel became the linked one", async () => {
  t.respond("getChat", (p) => ({ id: p.chat_id, type: "supergroup", linked_chat_id: -500 }));
  await run(command("/ban", { reply_to_message: replyTo(ANA, { sender_chat: CHANNEL }) }));
  expect(t.callsOf("banChatSenderChat")).toEqual([]);
  expect(getChat(db, CHAT)!.linkedChatId).toBe(-500);
});

test("/ban on another channel's message bans the channel", async () => {
  await run(command("/ban", { reply_to_message: replyTo(ANA, { sender_chat: CHANNEL }) }));
  expect(t.callsOf("banChatSenderChat").map((c) => c.payload.sender_chat_id)).toEqual([-500]);
  expect(events()[0]).toMatchObject({ senderType: "chat", senderId: -500, senderName: "Canal" });
});

test("if the target cannot be checked, it does nothing", async () => {
  t.respond("getChatMember", (p) => {
    if (p.user_id === 20) throw new Error("network");
    return members[10];
  });
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(sent()).toEqual(["I could not check that user, so I did nothing."]);
});

test("a failed ban is reported and recorded, and keeps the warnings", async () => {
  addWarning(db, CHAT, 20, null, START_MS / 1000);
  t.respond("banChatMember", () => { throw new Error("not enough rights"); });
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(sent()).toEqual(["I could not ban Pepe. Check that I have permission to ban users."]);
  expect(events()[0]).toMatchObject({ banOk: false, error: "ban: not enough rights" });
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(1);
});

test("a failed delete does not stop the ban", async () => {
  t.respond("deleteMessages", () => { throw new Error("not enough rights"); });
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);
  expect(events()[0]).toMatchObject({ deleteOk: false, banOk: true, error: "delete: not enough rights" });
});

test("a name that looks like a link is never repeated in the group", async () => {
  await run(command("/warn", { reply_to_message: replyTo({ id: 20, is_bot: false, first_name: "buy at spam.example" }) }));
  expect(sent()).toEqual(["Warning 1/3 for 20."]);
  await run(command("/ban", { reply_to_message: replyTo({ id: 20, is_bot: false, first_name: "buy at spam.example" }) }));
  expect(sent()[1]).toBe("Banned 20.");
});

test("a very long reason is cut", async () => {
  await run(command(`/ban ${"x".repeat(500)}`, { reply_to_message: replyTo() }));
  expect(sent()[0]).toBe(`Banned Pepe. Reason: ${"x".repeat(200)}`);
});

test("messages from the bot use no formatting mode and do not notify", async () => {
  await run(command("/ban <b>spam</b>", { reply_to_message: replyTo() }));
  const [payload] = t.callsOf("sendMessage").map((c) => c.payload);
  expect(payload.parse_mode).toBeUndefined();
  expect(payload.disable_notification).toBe(true);
  expect(payload.link_preview_options).toEqual({ is_disabled: true });
});

test("/warn counts up, keeps the comment and removes only the command", async () => {
  const update = command("/warn be nice", { reply_to_message: replyTo() });
  await run(update);
  expect(deleted()).toEqual([commandId(update)]);
  expect(banned()).toEqual([]);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(1);
  expect(sent()).toEqual(["Warning 1/3 for Pepe. Reason: be nice"]);
  expect(events()[0]).toMatchObject({ senderId: 20, action: "warn", matched: "/warn by Ana (1/3): be nice", text: "buy my stuff", banOk: null });
});

test("/warn at the limit bans, deletes the comment and starts from zero", async () => {
  const third = command("/warn", { reply_to_message: replyTo() });
  await run(command("/warn", { reply_to_message: replyTo() }), command("/warn", { reply_to_message: replyTo() }), third);
  expect(banned()).toEqual([20]);
  expect(deleted()).toContain(700);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(0);
  expect(sent()[2]).toBe("Pepe reached 3/3 warnings and was banned.");
  expect(events()[0]).toMatchObject({ senderId: 20, action: "delete_ban", matched: "/warn by Ana (3/3)", banOk: true });
});

test("/unban lifts the ban, clears the warnings and marks earlier bans as undone", async () => {
  insertEvent(db, {
    chatId: CHAT, senderType: "user", senderId: 20, senderName: "Pepe", filter: "word", matched: "x", text: null,
    action: "delete_ban", deleteOk: true, banOk: true, error: null, dryRun: false,
  });
  addWarning(db, CHAT, 20, null, START_MS / 1000);
  const update = command("/unban 20");
  await run(update);
  expect(t.callsOf("unbanChatMember").map((c) => c.payload)).toEqual([{ chat_id: CHAT, user_id: 20, only_if_banned: true }]);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(0);
  expect(deleted()).toEqual([commandId(update)]);
  expect(sent()).toEqual(["Unbanned 20. They can rejoin on their own."]);
  const [unban, ban] = events();
  expect(unban).toMatchObject({ action: "unban", matched: "/unban by Ana", banOk: null });
  expect(ban!.unbannedAt).not.toBeNull();
});

test("/unban on a channel's message unbans the channel", async () => {
  await run(command("/unban", { reply_to_message: replyTo(ANA, { sender_chat: CHANNEL }) }));
  expect(t.callsOf("unbanChatSenderChat").map((c) => c.payload.sender_chat_id)).toEqual([-500]);
});

test("a failed unban is reported and keeps the warnings", async () => {
  addWarning(db, CHAT, 20, null, START_MS / 1000);
  t.respond("unbanChatMember", () => { throw new Error("nope"); });
  await run(command("/unban 20"));
  expect(sent()).toEqual(["I could not unban 20. Check that I have permission to ban users."]);
  expect(countWarnings(db, CHAT, 20, START_MS / 1000)).toBe(1);
  expect(events()[0]).toMatchObject({ action: "unban", error: "unban: nope" });
});

test("in development bans are simulated, but protected people stay protected", async () => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  updateChatSettings(db, CHAT, { commandsEnabled: true });
  setup("development");
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(deleted()).toContain(700);
  expect(sent()).toEqual(["Banned Pepe (simulated)."]);
  expect(events()[0]).toMatchObject({ dryRun: true, banOk: null });

  members[20] = { status: "administrator", user: PEPE };
  await run(command("/ban", { reply_to_message: replyTo() }));
  expect(sent()[1]).toBe("Pepe is an admin.");

  await run(command("/unban 30"));
  expect(t.callsOf("unbanChatMember")).toEqual([]);
  expect(sent()[2]).toBe("Unbanned 30 (simulated). They can rejoin on their own.");
});

test("/ban@test_bot works, and /ban@another_bot is left alone", async () => {
  await run(command("/ban@test_bot", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);

  members[10] = { status: "member", user: ANA };
  nextCalled = false;
  await run(command("/ban@another_bot", { reply_to_message: replyTo() }));
  expect(banned()).toEqual([20]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
  expect(nextCalled).toBe(true);
});

test("editing an old message into a command does nothing", async () => {
  await run(editedGroupMessage({ text: "/ban", from: ANA, entities: [{ type: "bot_command", offset: 0, length: 4 }], reply_to_message: replyTo() }));
  expect(banned()).toEqual([]);
  expect(nextCalled).toBe(true);
});

test("/ban in the middle of a sentence is not a command", async () => {
  members[10] = { status: "member", user: ANA };
  await run(groupMessage({ text: "use /ban", from: ANA, entities: [{ type: "bot_command", offset: 4, length: 4 }] }));
  expect(t.calls).toEqual([]);
  expect(nextCalled).toBe(true);
});

test.each([
  ["in a photo caption", { caption: "/ban 20", text: undefined, photo: [], caption_entities: [{ type: "bot_command", offset: 0, length: 4 }] }],
  ["forwarded from elsewhere", { text: "/ban 20", entities: [{ type: "bot_command", offset: 0, length: 4 }], forward_origin: { type: "hidden_user", date: 0, sender_user_name: "x" } }],
  ["sent through an inline bot", { text: "/ban 20", entities: [{ type: "bot_command", offset: 0, length: 4 }], via_bot: { id: 5, is_bot: true, first_name: "Inline" } }],
])("a /ban %s is not a command, and nobody is warned", async (_name, overrides) => {
  members[10] = { status: "member", user: ANA };
  await run(groupMessage({ from: ANA, ...overrides } as Partial<Message>));
  expect(t.calls).toEqual([]);
  expect(countWarnings(db, CHAT, 10, START_MS / 1000)).toBe(0);
  expect(nextCalled).toBe(true);
});
