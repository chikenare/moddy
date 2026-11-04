import { Composer } from "grammy";
import { config } from "../config.js";
import { findPayment, fulfillOrder } from "../services/orders.js";
import { getPlan } from "../services/plans.js";
import { planDuration, planPriceInStars } from "../utils/format.js";

export const paymentsHandler = new Composer();

function parsePayload(payload: string): { planId: number; stars: number } | null {
  const m = /^plan:(\d+):(\d+)$/.exec(payload);
  return m ? { planId: Number(m[1]), stars: Number(m[2]) } : null;
}

// Telegram exige responder en < 10 s. Revalidamos plan y precio contra la API.
paymentsHandler.on("pre_checkout_query", async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const parsed = parsePayload(q.invoice_payload);
  try {
    if (!parsed || q.currency !== "XTR") throw new Error("payload inválido");
    const plan = await getPlan(parsed.planId, { fresh: true });
    if (!plan) {
      return await ctx.answerPreCheckoutQuery(false, {
        error_message: "Este plan ya no está disponible. Usa /planes para ver los actuales.",
      });
    }
    const current = planPriceInStars(plan);
    if (current !== parsed.stars || q.total_amount !== current) {
      return await ctx.answerPreCheckoutQuery(false, {
        error_message: "El precio de este plan cambió. Usa /planes para obtener una factura nueva.",
      });
    }
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error("[payments] pre_checkout rechazado", err);
    await ctx.answerPreCheckoutQuery(false, {
      error_message: "No pudimos validar tu compra. Intenta de nuevo en unos minutos.",
    });
  }
});

paymentsHandler.on("message:successful_payment", async (ctx) => {
  const sp = ctx.message.successful_payment;
  const parsed = parsePayload(sp.invoice_payload);
  const plan = parsed ? await getPlan(parsed.planId).catch(() => undefined) : undefined;

  if (!parsed || !plan) {
    // El cobro ya se hizo: no podemos perderlo. Se registra para revisión manual.
    console.error("[payments] PAGO SIN PLAN RECONOCIBLE", sp);
    await ctx.reply(
      "Recibimos tu pago, pero hubo un problema al activar tu plan. " +
        "Escríbenos con /paysupport y lo resolvemos.",
    );
    return;
  }

  const result = await fulfillOrder({
    telegramUserId: ctx.from.id,
    plan,
    stars: sp.total_amount,
    telegramChargeId: sp.telegram_payment_charge_id,
    paidAt: new Date(),
  });
  if (result === "duplicate") return;

  await ctx.reply(
    `✅ ¡Pago recibido! Tu plan <b>${plan.name}</b> está activo por ${planDuration(plan)}.\n\n` +
      `ID de transacción:\n<code>${sp.telegram_payment_charge_id}</code>`,
    { parse_mode: "HTML" },
  );
});

// Obligatorio para bots que cobran (políticas de pagos de Telegram).
paymentsHandler.command("paysupport", (ctx) =>
  ctx.reply(
    "🛟 <b>Soporte de pagos</b>\n\n" +
      "Si tuviste un problema con una compra, envíanos el ID de transacción que recibiste " +
      "al pagar y una descripción del problema." +
      (config.supportContact ? `\n\nContacto: ${config.supportContact}` : ""),
    { parse_mode: "HTML" },
  ),
);

paymentsHandler.command("terms", (ctx) =>
  ctx.reply(
    "📄 <b>Términos de compra</b>\n\n" +
      "• Los planes se pagan una sola vez con Telegram Stars y dan acceso durante el periodo indicado.\n" +
      "• No se renuevan automáticamente.\n" +
      "• Para problemas o reembolsos usa /paysupport.",
    { parse_mode: "HTML" },
  ),
);

// /refund <charge_id> [user_id] — solo administradores. Útil para pruebas.
paymentsHandler.command("refund", async (ctx) => {
  if (!ctx.from || !config.adminIds.includes(ctx.from.id)) return;
  const [chargeId, userArg] = ctx.match.trim().split(/\s+/);
  if (!chargeId) return ctx.reply("Uso: /refund <charge_id> [user_id]");
  const userId = userArg ? Number(userArg) : (findPayment(chargeId)?.telegramUserId ?? ctx.from.id);
  try {
    await ctx.api.refundStarPayment(userId, chargeId);
    // TODO: desactivar el plan / marcar la orden como reembolsada en la API.
    await ctx.reply(`↩️ Reembolso hecho a ${userId}.`);
  } catch (err) {
    await ctx.reply(`No se pudo reembolsar: ${(err as Error).message}`);
  }
});
