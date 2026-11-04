import { Bot } from "grammy";
import { config } from "./config.js";
import { paymentsHandler } from "./handlers/payments.js";
import { plansHandler } from "./handlers/plans.js";

const bot = new Bot(config.botToken);

bot.command("start", (ctx) =>
  ctx.reply(
    `¡Hola, ${ctx.from?.first_name ?? ""}! 👋\n\n` +
      "Usa /planes para ver los planes y comprar con Telegram Stars.",
  ),
);

bot.command("help", (ctx) =>
  ctx.reply(
    "Comandos disponibles:\n" +
      "/terms - Términos de compra\n" +
      "/paysupport - Soporte de pagos\n" +
      "/help - Esta ayuda",
  ),
);

bot.use(plansHandler);
bot.use(paymentsHandler);

bot.catch((err) => {
  console.error(`Error procesando update ${err.ctx.update.update_id}:`, err.error);
});

const shutdown = () => bot.stop();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.api.setMyCommands([
  { command: "terms", description: "Términos de compra" },
  { command: "paysupport", description: "Soporte de pagos" },
  { command: "help", description: "Ver ayuda" },
]);

bot.start({
  onStart: (me) => console.log(`Bot iniciado como @${me.username}`),
});
