import { Composer, type Context } from "grammy";
import { getChat } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { recordSeenUser } from "../db/staff.js";
import type { StatsSink } from "../metrics/collector.js";

// Telegram can't look up a @username, so this is what lets the panel add staff by name.
// Service messages (joins, pins, title changes...) carry none of these.
export const CONTENT_KEYS = [
  "text", "caption", "photo", "video", "document", "sticker", "voice", "audio", "animation", "video_note",
  "poll", "location", "contact", "dice", "venue", "game", "story", "paid_media",
] as const;

export function createSeenUsersHandler(deps: { db: Db; stats?: StatsSink }): Composer<Context> {
  const { db, stats } = deps;
  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).on("message", (ctx, next) => {
    const { from, sender_chat: senderChat } = ctx.message;
    const chat = getChat(db, ctx.chat.id);
    if (stats) {
      const message = ctx.message;
      const joined = message.new_chat_members?.filter((m) => !m.is_bot).length ?? 0;
      if (joined) stats.add(ctx.chat.id, "joins", joined);
      if (message.left_chat_member && !message.left_chat_member.is_bot) stats.add(ctx.chat.id, "leaves");
      if (!from.is_bot && !senderChat && CONTENT_KEYS.some((k) => message[k] !== undefined)) stats.add(ctx.chat.id, "messages");
    }
    if (chat && (chat.moderationEnabled || chat.autoRepliesEnabled || chat.commandsEnabled) && !from.is_bot && !senderChat) {
      try {
        recordSeenUser(db, chat.id, {
          id: from.id,
          username: from.username,
          displayName: [from.first_name, from.last_name].filter(Boolean).join(" "),
        });
      } catch (e) {
        console.error(`Could not remember a user in chat ${chat.id}:`, e);
      }
    }
    return next();
  });

  return composer;
}
