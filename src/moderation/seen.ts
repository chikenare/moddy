import { Composer, type Context } from "grammy";
import { getChat } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { recordSeenUser } from "../db/staff.js";

// Telegram can't look up a @username, so this is what lets the panel add staff by name.
export function createSeenUsersHandler(deps: { db: Db }): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).on("message", (ctx, next) => {
    const { from, sender_chat: senderChat } = ctx.message;
    const chat = getChat(db, ctx.chat.id);
    if (chat && (chat.moderationEnabled || chat.autoRepliesEnabled) && !from.is_bot && !senderChat) {
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
