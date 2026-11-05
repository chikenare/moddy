import type { StatTotals } from "@/lib/api";

export function formatCount(n: number, locale = "en-US"): string {
  if (n < 10_000) return n.toLocaleString(locale);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export interface Delta { direction: "up" | "down" | "flat" | "new"; text: string }

// Compares with the previous period; a jump from zero has no meaningful percentage.
export function delta(current: number, previous: number): Delta {
  if (current === previous) return { direction: "flat", text: "No change" };
  if (previous === 0) return { direction: "new", text: "New" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: current > previous ? "up" : "down", text: "<1%" };
  return { direction: pct > 0 ? "up" : "down", text: `${Math.abs(pct)}%` };
}

export function shortDay(day: string, locale = "en-US"): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ruleHits(t: StatTotals): number {
  return t.link_hits + t.word_hits + t.flood_hits + t.bot_hits;
}

export function hasActivity(t: StatTotals): boolean {
  return Object.values(t).some((n) => n > 0);
}

// A round axis maximum so ticks land on clean numbers.
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).filter(Number.isInteger).find((s) => s * 4 >= max)!;
  return step * 4;
}
