import { Composer, type Context } from "grammy";
import type { Message } from "grammy/types";
import type { Db } from "../db/connection.js";
import { getChat } from "../db/chats.js";
import { listWhitelist, listWords } from "../db/lists.js";
import type { Violation } from "./enforcer.js";
import { type FloodTracker, fingerprintOf } from "./flood.js";
import { extractLinks, findUnauthorizedLink } from "./links.js";
import { isStructurallyExempt, senderOf } from "./sender.js";
import { findBannedWord, maskEntities } from "./words.js";

export function createModerationHandler(deps: {
  db: Db;
  enforcer: { enqueue(v: Violation): void };
  flood: FloodTracker;
}): Composer<Context> {
  const { db, enforcer, flood } = deps;
  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).on(["message", "edited_message"], async (ctx, next) => {
    const message = ctx.msg as Message;
    const chatId = ctx.chat.id;
    const chat = getChat(db, chatId);
    if (!chat || !chat.moderationEnabled) return next();
    if (isStructurallyExempt(message, chat)) return next();

    const sender = senderOf(message);
    const adminCheckUserId = sender.type === "user" ? sender.id : null;
    const text = message.text ?? message.caption ?? null;
    const noticeTemplate = chat.noticeEnabled ? chat.noticeTemplate : null;
    const base = { chatId, text, messageIds: [message.message_id], noticeTemplate };

    if (chat.botFilterEnabled && ctx.message?.new_chat_members && message.from) {
      const bots = message.new_chat_members?.filter((m) => m.is_bot && m.id !== ctx.me.id) ?? [];
      for (const bot of bots) {
        enforcer.enqueue({
          ...base, text: null, action: "delete_ban", filter: "bot",
          sender: { type: "user", id: bot.id, name: bot.first_name },
          matched: bot.username ? `@${bot.username}` : bot.first_name,
          adminCheckUserId: message.from.id,
        });
      }
      if (bots.length) return;
    }

    if (chat.linkFilterEnabled) {
      const link = findUnauthorizedLink(extractLinks(message), listWhitelist(db, chatId));
      if (link !== undefined) {
        enforcer.enqueue({ ...base, sender, filter: "link", matched: link, action: chat.linkFilterAction, adminCheckUserId });
        return;
      }
    }

    if (chat.wordFilterEnabled && text !== null) {
      const scanned = message.text !== undefined
        ? maskEntities(message.text, message.entities)
        : maskEntities(text, message.caption_entities);
      const word = findBannedWord(scanned, listWords(db, chatId));
      if (word !== undefined) {
        enforcer.enqueue({ ...base, sender, filter: "word", matched: word, action: chat.wordFilterAction, adminCheckUserId });
        return;
      }
    }

    if (chat.floodFilterEnabled && ctx.message) {
      const fingerprint = fingerprintOf(message);
      if (fingerprint) {
        const ids = flood.record(
          `${chatId}:${sender.id}`,
          { messageId: message.message_id, date: message.date, fingerprint },
          { count: chat.floodCount, seconds: chat.floodSeconds },
        );
        if (ids) {
          enforcer.enqueue({
            chatId, sender, filter: "flood", text, messageIds: ids, adminCheckUserId, noticeTemplate,
            matched: `${ids.length} messages in ${chat.floodSeconds} s`, action: chat.floodFilterAction,
          });
          return;
        }
      }
    }

    return next();
  });

  return composer;
}
