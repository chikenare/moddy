import { Composer, type Context } from "grammy";
import { getChat } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { COOLDOWN_MS, Cooldown, replyInBackground } from "./reply.js";

export function createRulesHandler(deps: { db: Db; now?: () => number }): Composer<Context> {
  const { db } = deps;
  const cooldown = new Cooldown(COOLDOWN_MS, deps.now ?? Date.now);
  const composer = new Composer<Context>();

  composer.chatType(["group", "supergroup"]).command("rules", (ctx) => {
    const chat = getChat(db, ctx.chat.id);
    if (chat?.rules && cooldown.take(String(ctx.chat.id))) replyInBackground(ctx, chat.rules, chat.rulesEntities);
  });

  return composer;
}
