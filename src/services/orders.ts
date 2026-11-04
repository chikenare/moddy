import type { Plan } from "./plans.js";

export interface CompletedPayment {
  telegramUserId: number;
  plan: Plan;
  stars: number;
  telegramChargeId: string;
  paidAt: Date;
}

// TODO: sustituir por persistencia real.
// Por ahora se guarda en memoria solo para evitar procesar dos veces el mismo cobro.
const processed = new Map<string, CompletedPayment>();

/**
 * Se llama cuando Telegram confirma el pago. Debe ser idempotente:
 * el mismo telegramChargeId nunca debe activar el plan dos veces.
 */
export async function fulfillOrder(payment: CompletedPayment): Promise<"ok" | "duplicate"> {
  if (processed.has(payment.telegramChargeId)) return "duplicate";
  processed.set(payment.telegramChargeId, payment);

  // TODO: cuando tengamos acceso a la API:
  //   1. Crear la orden (plan, usuario, monto en Stars, charge id).
  //   2. Activar/extender la suscripción del usuario por plan.billingPeriod.
  console.log("[orders] pago completado", {
    user: payment.telegramUserId,
    plan: payment.plan.slug,
    stars: payment.stars,
    charge: payment.telegramChargeId,
  });
  return "ok";
}

export function findPayment(chargeId: string): CompletedPayment | undefined {
  return processed.get(chargeId);
}
