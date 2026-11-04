import { serve } from "@hono/node-server";
import { Bot } from "grammy";
import { createApi } from "./api/app.js";
import { createAutoRepliesHandler } from "./community/auto-replies.js";
import { createRulesHandler } from "./community/rules.js";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { purgeEvents } from "./db/events.js";
import { purgeMessages } from "./db/messages.js";
import { purgeSeenUsers } from "./db/staff.js";
import { createEnforcer } from "./moderation/enforcer.js";
import { FloodTracker } from "./moderation/flood.js";
import { createModerationHandler } from "./moderation/handler.js";
import { createRegistrationHandler } from "./moderation/registration.js";
import { createSeenUsersHandler } from "./moderation/seen.js";
import { createScheduler } from "./messages/scheduler.js";
import { runShutdown } from "./shutdown.js";

const bot = new Bot(config.botToken);
const db = openDatabase(config.databasePath);
const flood = new FloodTracker();
const enforcer = createEnforcer({ api: bot.api, db, appEnv: config.appEnv });
const scheduler = createScheduler({ api: bot.api, db });

bot.use(createRegistrationHandler({ db }));
bot.use(createSeenUsersHandler({ db }));
bot.use(createModerationHandler({ db, enforcer, flood }));
bot.use(createRulesHandler({ db }));
bot.use(createAutoRepliesHandler({ db }));

const privateChat = bot.chatType("private");

privateChat.command("start", (ctx) =>
  ctx.reply(`Hi, ${ctx.from?.first_name ?? "there"}! 👋 I'm a group moderation bot.`),
);

privateChat.command("help", (ctx) => ctx.reply("Available commands:\n/help - Show this help"));

bot.catch((err) => {
  console.error(`Failed to process update ${err.ctx.update.update_id}:`, err.error);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const purge = () => {
  try {
    const now = Math.floor(Date.now() / 1000);
    purgeEvents(db, now);
    purgeSeenUsers(db, now);
    purgeMessages(db, now);
  } catch (e) {
    console.error("Could not purge history:", e);
  }
};
purge();
setInterval(purge, DAY_MS).unref();

const api = createApi({
  db,
  telegram: bot.api,
  appEnv: config.appEnv,
  botUsername: () => (bot.isInited() ? bot.botInfo.username : null),
  onMessageQueued: () => scheduler.kick(),
});
const server = serve({ fetch: api.fetch, port: config.apiPort });

let closing = false;
let polling: Promise<void> = Promise.resolve();
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await runShutdown([
    ["bot.stop", () => bot.stop()],
    ["polling", () => polling],
    ["server", () => new Promise<void>((resolve) => server.close(() => resolve()))],
    ["enforcer.drain", () => enforcer.drain()],
    ["scheduler", () => scheduler.stop()],
    ["db.close", () => db.close()],
  ]);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.api.deleteMyCommands();
await bot.api.setMyCommands([{ command: "help", description: "Show help" }], { scope: { type: "all_private_chats" } });
await bot.api.setMyCommands([{ command: "rules", description: "Show the group rules" }], { scope: { type: "all_group_chats" } });

scheduler.start();

polling = bot.start({
  allowed_updates: ["message", "edited_message", "channel_post", "my_chat_member"],
  onStart: (me) => console.log(`Bot started as @${me.username}`),
});
polling.catch((e) => {
  if (closing) return;
  console.error("Bot polling ended with an error:", e);
  process.exit(1);
});
