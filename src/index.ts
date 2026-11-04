import { serve } from "@hono/node-server";
import { Bot } from "grammy";
import { createApi } from "./api/app.js";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { purgeEvents } from "./db/events.js";
import { createEnforcer } from "./moderation/enforcer.js";
import { FloodTracker } from "./moderation/flood.js";
import { createModerationHandler } from "./moderation/handler.js";
import { createRegistrationHandler } from "./moderation/registration.js";

const bot = new Bot(config.botToken);
const db = openDatabase(config.databasePath);
const flood = new FloodTracker();
const enforcer = createEnforcer({ api: bot.api, db, appEnv: config.appEnv });

bot.use(createRegistrationHandler({ db }));
bot.use(createModerationHandler({ db, enforcer, flood }));

bot.command("start", (ctx) =>
  ctx.reply(`¡Hola, ${ctx.from?.first_name ?? ""}! 👋 Soy un bot de moderación de grupos.`),
);

bot.command("help", (ctx) => ctx.reply("Comandos disponibles:\n/help - Esta ayuda"));

bot.catch((err) => {
  console.error(`Error procesando update ${err.ctx.update.update_id}:`, err.error);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const purge = () => {
  try {
    purgeEvents(db, Math.floor(Date.now() / 1000));
  } catch (e) {
    console.error("No se pudo purgar el historial:", e);
  }
};
purge();
setInterval(purge, DAY_MS).unref();

const api = createApi({ db, telegram: bot.api, appEnv: config.appEnv });
const server = serve({ fetch: api.fetch, port: config.apiPort });

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await bot.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await enforcer.drain();
  db.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.api.setMyCommands([{ command: "help", description: "Ver ayuda" }]);

bot.start({
  allowed_updates: ["message", "edited_message", "channel_post", "my_chat_member"],
  onStart: (me) => console.log(`Bot iniciado como @${me.username}`),
});
