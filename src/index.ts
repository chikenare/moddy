import { Bot } from "grammy";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";
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

const shutdown = () => bot.stop();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.api.setMyCommands([{ command: "help", description: "Ver ayuda" }]);

bot.start({
  onStart: (me) => console.log(`Bot iniciado como @${me.username}`),
});
