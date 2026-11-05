import { type Api, Composer, type Context } from "grammy";
import type { Message } from "grammy/types";
import { type ChatRecord, getChat, updateChatInfo } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { type EventAction, insertEvent, markUnbanned } from "../db/events.js";
import { findSeenUser, isStaff } from "../db/staff.js";
import { addWarning, clearWarnings } from "../db/warnings.js";
import type { AppEnv } from "../env.js";
import type { StatsSink } from "../metrics/collector.js";
import { safeName } from "./notice.js";
import { withRetry } from "./retry.js";
import { CONTENT_KEYS } from "./seen.js";
import { type Sender, senderFromUser, senderOf } from "./sender.js";

const COMMANDS = ["ban", "unban", "warn"] as const;
type CommandName = (typeof COMMANDS)[number];

export type CommandsApi = Pick<Api, "getChat" | "getChatMember" | "deleteMessages" | "banChatMember" | "banChatSenderChat" | "unbanChatMember" | "unbanChatSenderChat" | "sendMessage">;

const MAX_REASON = 200;
const NOTICE_INTERVAL_MS = 10_000;
// Telegram's own accounts: 777000 forwards channel posts, the others stand in for anonymous admins and channels.
const SERVICE_ACCOUNTS = new Set([777000, 1087968824, 136817688]);

interface Invocation {
  chat: ChatRecord;
  message: Message;
  name: CommandName;
  botId: number;
  anonymous: boolean;
}

type Resolved = { target: Sender; reason: string | null; replied: Message | null; mention: string | null } | { problem: string };
type BanResult = "banned" | "simulated" | "failed";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const COULD_NOT = "Check that I have permission to ban users, and see the history in the panel.";

// Moderators see the ID too, so a wrong target shows at once.
function label(target: Sender): string {
  const name = safeName(target);
  return name === String(target.id) ? name : `${name} (${target.id})`;
}

// A reply that really points at a message. In a forum topic every message counts as a reply to the topic's first one,
// and in a channel's comments, as a reply to the post.
function pointedReply(message: Message): Message | null {
  const reply = message.reply_to_message;
  if (!reply || reply.is_automatic_forward) return null;
  return message.is_topic_message && reply.message_id === message.message_thread_id ? null : reply;
}

// A service message's sender is whoever caused it, not who it is about.
function targetOfReply(reply: Message): Sender | null {
  if (reply.new_chat_members?.length === 1) return senderFromUser(reply.new_chat_members[0]!);
  return CONTENT_KEYS.some((key) => reply[key] !== undefined) ? senderOf(reply) : null;
}

function cleanReason(raw: string): string | null {
  const chars = Array.from(raw.trim());
  return chars.length ? chars.slice(0, MAX_REASON).join("") : null;
}

export function createCommandsHandler(deps: {
  api: CommandsApi;
  db: Db;
  appEnv: AppEnv;
  queue: { run(chatId: number, task: () => Promise<void>): void };
  stats?: StatsSink;
  now?: () => number;
}): Composer<Context> {
  const { api, db, appEnv, queue, stats } = deps;
  const now = deps.now ?? Date.now;
  const nowSeconds = () => Math.floor(now() / 1000);
  const production = appEnv === "production";
  const lastNotice = new Map<number, number>();

  async function say(inv: Invocation, text: string, replyToCommand = false): Promise<void> {
    try {
      await api.sendMessage(inv.chat.id, text, {
        disable_notification: true,
        link_preview_options: { is_disabled: true },
        ...(inv.message.is_topic_message ? { message_thread_id: inv.message.message_thread_id } : {}),
        ...(replyToCommand ? { reply_parameters: { message_id: inv.message.message_id, allow_sending_without_reply: true } } : {}),
      });
    } catch (e) {
      console.error(`Could not answer a command in chat ${inv.chat.id}:`, e);
    }
  }

  // For people without permission: they could otherwise make the bot flood the group.
  async function sayLimited(inv: Invocation, text: string): Promise<void> {
    const at = now();
    const last = lastNotice.get(inv.chat.id);
    if (last !== undefined && at - last < NOTICE_INTERVAL_MS) return;
    lastNotice.set(inv.chat.id, at);
    await say(inv, text);
  }

  async function remove(chatId: number, messageIds: number[]): Promise<string | null> {
    try {
      await withRetry(() => api.deleteMessages(chatId, messageIds));
      stats?.add(chatId, "deleted", messageIds.length);
      return null;
    } catch (e) {
      return `delete: ${messageOf(e)}`;
    }
  }

  function record(chatId: number, target: Sender, action: EventAction, details: {
    matched: string; text: string | null; deleteOk: boolean | null; banOk: boolean | null; error: string | null; dryRun: boolean;
  }): void {
    try {
      insertEvent(db, {
        chatId, senderType: target.type, senderId: target.id, senderName: target.name, filter: "command", action, ...details,
      }, nowSeconds());
    } catch (e) {
      console.error(`Could not record a command in chat ${chatId}:`, e);
    }
  }

  async function ban(inv: Invocation, target: Sender, details: { matched: string; text: string | null; messageIds: number[] }): Promise<BanResult> {
    const chatId = inv.chat.id;
    const errors: string[] = [];
    let banOk: boolean | null = null;
    if (production) {
      try {
        await withRetry(() => (target.type === "chat" ? api.banChatSenderChat(chatId, target.id) : api.banChatMember(chatId, target.id)));
        banOk = true;
        stats?.add(chatId, "banned");
      } catch (e) {
        banOk = false;
        errors.push(`ban: ${messageOf(e)}`);
      }
    }
    // If the ban failed the comment stays, as evidence for the moderator.
    const deleteError = await remove(chatId, banOk === false ? [inv.message.message_id] : details.messageIds);
    if (deleteError) errors.push(deleteError);
    record(chatId, target, "delete_ban", {
      matched: details.matched, text: details.text, deleteOk: deleteError === null, banOk,
      error: errors.length ? errors.join("; ") : null, dryRun: !production,
    });
    if (banOk === false) return "failed";
    clearWarnings(db, chatId, target.id);
    return production ? "banned" : "simulated";
  }

  function resolveTarget(inv: Invocation): Resolved {
    const { message, chat } = inv;
    const text = message.text ?? "";
    const entities = message.entities ?? [];
    let start = entities.find((e) => e.type === "bot_command" && e.offset === 0)?.length ?? 0;
    while (start < text.length && /\s/.test(text[start]!)) start++;

    const named = entities.find((e) => e.offset === start && (e.type === "mention" || e.type === "text_mention"));
    if (named) {
      const reason = cleanReason(text.slice(named.offset + named.length));
      if (named.type === "text_mention") return { target: senderFromUser(named.user), reason, replied: null, mention: null };
      const mention = text.slice(named.offset, named.offset + named.length);
      const seen = findSeenUser(db, chat.id, mention.slice(1));
      if (!seen) return { problem: `I haven't seen ${mention} in this group. Reply to one of their messages, or use their numeric ID.` };
      return { target: { type: "user", id: seen.userId, name: seen.displayName }, reason, replied: null, mention };
    }

    const args = text.slice(start);
    const reply = pointedReply(message);
    const replyTarget = reply && targetOfReply(reply);
    if (replyTarget) return { target: replyTarget, reason: cleanReason(args), replied: reply, mention: null };

    const id = /^\d{1,16}(?=\s|$)/.exec(args);
    if (id) return { target: { type: "user", id: Number(id[0]), name: id[0] }, reason: cleanReason(args.slice(id[0].length)), replied: null, mention: null };
    // No slash before a command name here: Telegram makes those tappable for everyone in the group.
    return { problem: "Reply to someone's message, or name them with @user or their numeric ID. You can add a reason after it." };
  }

  // Returns why not, or the target with the name Telegram has for them.
  async function checkTarget(inv: Invocation, target: Sender, mention: string | null): Promise<{ refusal: string } | { target: Sender }> {
    const chatId = inv.chat.id;
    const refuse = (refusal: string) => ({ refusal });
    if (target.type === "chat") {
      if (target.id === chatId) return refuse("That is an anonymous admin.");
      if (target.id === inv.chat.linkedChatId) return refuse("That is this group's linked channel.");
      try {
        const info = await withRetry(() => api.getChat(chatId));
        if ("linked_chat_id" in info && info.linked_chat_id === target.id) {
          updateChatInfo(db, chatId, { linkedChatId: target.id });
          return refuse("That is this group's linked channel.");
        }
      } catch (e) {
        console.error(`Could not check a channel in chat ${chatId}:`, e);
        return refuse("I could not check that channel, so I did nothing.");
      }
      return { target };
    }
    if (target.id === inv.botId) return refuse("I can't do that to myself.");
    if (SERVICE_ACCOUNTS.has(target.id)) return refuse("That is a Telegram account.");
    if (!inv.anonymous && target.id === inv.message.from?.id) return refuse("You can't do that to yourself.");
    if (isStaff(db, chatId, target.id)) return refuse(`${safeName(target)} is on the staff list.`);
    try {
      const member = await withRetry(() => api.getChatMember(chatId, target.id));
      if (member.status === "creator" || member.status === "administrator") return refuse(`${safeName(target)} is an admin.`);
      if (mention && member.user.username?.toLowerCase() !== mention.slice(1).toLowerCase()) {
        return refuse("That username may belong to someone else now. Reply to one of their messages, or use their numeric ID.");
      }
      return { target: target.name === String(target.id) ? senderFromUser(member.user) : target };
    } catch (e) {
      console.error(`Could not check a user in chat ${chatId}:`, e);
      return refuse("I could not check that user, so I did nothing.");
    }
  }

  async function unban(inv: Invocation, target: Sender, matched: string): Promise<void> {
    const chatId = inv.chat.id;
    const deleteError = await remove(chatId, [inv.message.message_id]);
    const name = label(target);
    let error: string | null = null;
    if (production) {
      try {
        await withRetry(() => (target.type === "chat"
          ? api.unbanChatSenderChat(chatId, target.id)
          : api.unbanChatMember(chatId, target.id, { only_if_banned: true })));
        markUnbanned(db, chatId, target.type, target.id, nowSeconds());
      } catch (e) {
        error = `unban: ${messageOf(e)}`;
      }
    }
    record(chatId, target, "unban", {
      matched, text: null, deleteOk: deleteError === null, banOk: null,
      error: [deleteError, error].filter(Boolean).join("; ") || null, dryRun: !production,
    });
    if (error) return say(inv, `I could not unban ${safeName(target)}. ${COULD_NOT}`);
    clearWarnings(db, chatId, target.id);
    await say(inv, `Unbanned ${name}${production ? "" : " (simulated)"}. They can rejoin on their own.`);
  }

  async function warn(inv: Invocation, target: Sender, details: { by: string; reason: string | null; replied: Message | null }): Promise<void> {
    const { chat, message } = inv;
    const { by, reason, replied } = details;
    const count = addWarning(db, chat.id, target.id, reason, nowSeconds());
    const tally = `${count}/${chat.warnLimit}`;
    const name = label(target);
    const matched = `/warn by ${by} (${tally})${reason ? `: ${reason}` : ""}`;
    const text = replied ? replied.text ?? replied.caption ?? null : null;

    if (count >= chat.warnLimit) {
      const messageIds = replied ? [message.message_id, replied.message_id] : [message.message_id];
      const result = await ban(inv, target, { matched, text, messageIds });
      return say(inv, result === "failed"
        ? `I could not ban ${safeName(target)}. ${COULD_NOT}`
        : `${name} reached ${tally} warnings and was banned${result === "simulated" ? " (simulated)" : ""}.`);
    }

    const deleteError = await remove(chat.id, [message.message_id]);
    record(chat.id, target, "warn", { matched, text, deleteOk: deleteError === null, banOk: null, error: deleteError, dryRun: false });
    await say(inv, `Warning ${tally} for ${name}.${reason ? ` Reason: ${reason}` : ""}`);
  }

  // Tapping a blue command in a group sends it bare or addressed to the bot, maybe replying to the message it was in.
  // That is no attempt to moderate anyone, so it must not cost a warning: someone could post one as bait.
  function looksLikeATap(inv: Invocation): boolean {
    const text = inv.message.text ?? "";
    const commandLength = inv.message.entities?.find((e) => e.type === "bot_command" && e.offset === 0)?.length ?? 0;
    if (text.slice(commandLength).trim() !== "") return false;
    const reply = pointedReply(inv.message);
    return !reply || reply.from?.id === inv.botId || text.slice(0, commandLength).includes("@");
  }

  async function punish(inv: Invocation): Promise<void> {
    const { chat, message, name: command } = inv;
    if (looksLikeATap(inv)) {
      await remove(chat.id, [message.message_id]);
      return;
    }
    const offender = senderOf(message);
    const written = message.text ?? null;
    const count = addWarning(db, chat.id, offender.id, `Used /${command} without permission`, nowSeconds());
    const tally = `${count}/${chat.warnLimit}`;
    const matched = `Tried /${command} without permission (${tally})`;
    const name = safeName(offender);

    if (count >= chat.warnLimit) {
      const result = await ban(inv, offender, { matched, text: written, messageIds: [message.message_id] });
      if (result !== "failed") await sayLimited(inv, `${name} reached ${tally} warnings and was banned${result === "simulated" ? " (simulated)" : ""}.`);
      return;
    }

    const deleteError = await remove(chat.id, [message.message_id]);
    record(chat.id, offender, "warn", { matched, text: written, deleteOk: deleteError === null, banOk: null, error: deleteError, dryRun: false });
    await sayLimited(inv, `${name}, only admins and staff can use the ${command} command. Warning ${tally}.`);
  }

  async function authorization(inv: Invocation): Promise<"allowed" | "lacks-permission" | "denied" | "gone" | "unknown"> {
    if (inv.anonymous) return "allowed";
    const userId = inv.message.from!.id;
    if (isStaff(db, inv.chat.id, userId)) return "allowed";
    try {
      const member = await withRetry(() => api.getChatMember(inv.chat.id, userId));
      if (member.status === "creator") return "allowed";
      if (member.status === "administrator") return member.can_restrict_members ? "allowed" : "lacks-permission";
      // Already out of the group: a command queued behind their own ban.
      return member.status === "kicked" || member.status === "left" ? "gone" : "denied";
    } catch (e) {
      console.error(`Could not check who used a command in chat ${inv.chat.id}:`, e);
      return "unknown";
    }
  }

  async function execute(inv: Invocation): Promise<void> {
    const access = await authorization(inv);
    if (access === "unknown") return sayLimited(inv, "I could not check permissions for that command. Try again in a moment.");
    if (access === "gone") {
      await remove(inv.chat.id, [inv.message.message_id]);
      return;
    }
    if (access === "denied") return punish(inv);
    if (access === "lacks-permission") return say(inv, "You need the permission to ban users in this group.", true);

    const resolved = resolveTarget(inv);
    if ("problem" in resolved) return say(inv, resolved.problem, true);
    const { reason, replied, mention } = resolved;
    let { target } = resolved;
    if (target.type === "user" && target.id === 0) return say(inv, "I can't tell who sent that message.", true);

    const by = inv.anonymous ? "anonymous admin" : senderOf(inv.message).name;
    if (inv.name === "unban") return unban(inv, target, `/unban by ${by}`);

    const checked = await checkTarget(inv, target, mention);
    if ("refusal" in checked) return say(inv, checked.refusal, true);
    target = checked.target;
    if (inv.name === "warn") return warn(inv, target, { by, reason, replied });

    const result = await ban(inv, target, {
      matched: `/ban by ${by}${reason ? `: ${reason}` : ""}`,
      text: replied ? replied.text ?? replied.caption ?? null : null,
      messageIds: replied ? [inv.message.message_id, replied.message_id] : [inv.message.message_id],
    });
    await say(inv, result === "failed"
      ? `I could not ban ${safeName(target)}. ${COULD_NOT}`
      : `Banned ${label(target)}${result === "simulated" ? " (simulated)" : ""}.${reason ? ` Reason: ${reason}` : ""}`);
  }

  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).on("message").command([...COMMANDS], (ctx, next) => {
    const chat = getChat(db, ctx.chat.id);
    if (!chat?.commandsEnabled) return next();
    const message = ctx.message;
    // Text someone else wrote is not an order from the person who passed it along.
    if (message.forward_origin || message.via_bot) return next();
    const anonymous = message.sender_chat?.id === chat.id;
    // Someone posting as a channel can't be checked or warned, so the filters deal with them as usual.
    if ((message.sender_chat && !anonymous) || (!anonymous && !message.from)) return next();
    const name = ctx.entities("bot_command")[0]!.text.slice(1).split("@")[0] as CommandName;
    queue.run(chat.id, () => execute({ chat, message, name, botId: ctx.me.id, anonymous }));
    return undefined;
  });

  return composer;
}
