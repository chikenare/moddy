import { Composer, type Context } from "grammy";
import { listAutoReplies } from "../db/auto-replies.js";
import { getChat } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import type { StatsSink } from "../metrics/collector.js";
import { findBannedWord, maskEntities } from "../moderation/words.js";
import { COOLDOWN_MS, Cooldown, mentionSender, replyInBackground } from "./reply.js";

export function createAutoRepliesHandler(deps: { db: Db; now?: () => number; stats?: StatsSink }): Composer<Context> {
  const { db, stats } = deps;
  const cooldown = new Cooldown(COOLDOWN_MS, deps.now ?? Date.now);
  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).on("message", (ctx, next) => {
    const message = ctx.message;
    const chat = getChat(db, ctx.chat.id);
    if (!chat?.autoRepliesEnabled || message.is_automatic_forward) return next();

    const scanned = message.text !== undefined
      ? maskEntities(message.text, message.entities)
      : message.caption !== undefined ? maskEntities(message.caption, message.caption_entities) : null;
    if (scanned !== null) {
      const match = listAutoReplies(db, chat.id).find((r) => findBannedWord(scanned, r.triggers) !== undefined);
      if (match && cooldown.take(`${chat.id}:${match.id}`)) {
        const reply = mentionSender(ctx, match.reply, match.entities);
        replyInBackground(ctx, reply.text, reply.entities, () => stats?.add(chat.id, "auto_replies"));
      }
    }
    return next();
  });

  return composer;
}
