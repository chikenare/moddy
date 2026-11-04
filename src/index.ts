import { Bot } from "grammy";
import { config } from "./config.js";

const bot = new Bot(config.botToken);

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
