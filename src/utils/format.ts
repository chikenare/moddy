import { config } from "../config.js";
import type { Plan, PlanFeature } from "../services/plans.js";

export function planPriceInStars(plan: Plan): number {
  return Math.ceil(plan.price * config.starsPerUsd);
}

const INTERVALS: Record<Plan["billingInterval"], [string, string]> = {
  day: ["día", "días"],
  week: ["semana", "semanas"],
  month: ["mes", "meses"],
  year: ["año", "años"],
};

export function planDuration(plan: Plan): string {
  const [one, many] = INTERVALS[plan.billingInterval] ?? ["periodo", "periodos"];
  return `${plan.billingPeriod} ${plan.billingPeriod === 1 ? one : many}`;
}

function formatGB(bytes: number): string {
  // La API guarda GiB (p. ej. 107374200000 ≈ 100 GiB); lo mostramos como "100 GB".
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}

/** Texto legible de una característica, o null si no se muestra. */
function featureLine(f: PlanFeature): string | null {
  const n = Number(f.value);
  switch (f.slug) {
    case "resolution":
      return n >= 2160 ? "Resolución 4K" : `Resolución hasta ${n}p`;
    case "content-requests":
      return `${n} pedidos de títulos al mes`;
    case "download-bandwidth":
      return `${formatGB(n)} de descarga al mes`;
    case "book-downloads":
      return `${n} libros al mes`;
    case "content-lists":
      return `${n} listas personalizadas`;
    case "speed-limit":
      return null; // unidad pendiente de confirmar
    default:
      if (f.type === "toggle") return f.name;
      return null;
  }
}

export function planFeatures(plan: Plan): string[] {
  return [...plan.features]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(featureLine)
    .filter((l): l is string => l !== null);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
