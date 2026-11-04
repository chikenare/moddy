import { Composer, InlineKeyboard } from "grammy";
import { getPlan, getPlans, type Plan } from "../services/plans.js";
import { escapeHtml, planDuration, planFeatures, planPriceInStars } from "../utils/format.js";

export const plansHandler = new Composer();

function planCard(plan: Plan): string {
  const features = planFeatures(plan).map((f) => `  • ${escapeHtml(f)}`).join("\n");
  const local = plan.localPrice ? ` (${plan.localPrice.formatted})` : "";
  return (
    `<b>${escapeHtml(plan.name)}</b> — ⭐ ${planPriceInStars(plan)} · ${planDuration(plan)}\n` +
    `<i>US$${plan.price.toFixed(2)}${local}</i>\n${features}`
  );
}

async function showPlans(reply: (text: string, kb: InlineKeyboard) => Promise<unknown>) {
  const plans = await getPlans();
  if (plans.length === 0) {
    await reply("No hay planes disponibles en este momento.", new InlineKeyboard());
    return;
  }
  const kb = new InlineKeyboard();
  for (const p of plans) kb.text(`${p.name} · ⭐ ${planPriceInStars(p)}`, `buy:${p.id}`).row();
  const text =
    "💳 <b>Planes</b>\n\n" +
    plans.map(planCard).join("\n\n") +
    "\n\nPago único con Telegram Stars. Elige un plan:";
  await reply(text, kb);
}

plansHandler.command(["planes", "plans", "comprar"], async (ctx) => {
  try {
    await showPlans((text, kb) => ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }));
  } catch (err) {
    console.error("[plans] error obteniendo planes", err);
    await ctx.reply("No pude cargar los planes ahora mismo. Intenta de nuevo en unos minutos.");
  }
});

plansHandler.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
  const plan = await getPlan(Number(ctx.match[1])).catch(() => undefined);
  if (!plan) {
    await ctx.answerCallbackQuery({ text: "Ese plan ya no está disponible.", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();

  const stars = planPriceInStars(plan);
  const description = `Acceso ${plan.name} durante ${planDuration(plan)}. ${planFeatures(plan)
    .slice(0, 3)
    .join(", ")}.`.slice(0, 255);

  await ctx.replyWithInvoice(
    `Plan ${plan.name}`.slice(0, 32),
    description,
    // payload (máx. 128 bytes): plan + precio esperado, se valida en pre_checkout
    `plan:${plan.id}:${stars}`,
    "XTR",
    [{ label: `Plan ${plan.name}`, amount: stars }],
  );
});
