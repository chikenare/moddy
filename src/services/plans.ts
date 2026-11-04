import { config } from "../config.js";

export interface PlanFeature {
  id: number;
  name: string;
  slug: string;
  type: "limit" | "toggle" | "consumable";
  value: string;
  sortOrder: number;
}

export interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  isFree: boolean;
  price: number; // USD
  localPrice?: { amount: number; currency: string; formatted: string };
  billingInterval: "day" | "week" | "month" | "year";
  billingPeriod: number;
  sortOrder: number;
  features: PlanFeature[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { plans: Plan[]; fetchedAt: number } | null = null;

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch(`${config.apiBaseUrl}/public-plans`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`public-plans respondió ${res.status}`);
  const data = (await res.json()) as Plan[];
  return data
    .filter((p) => p.isActive && !p.isFree && p.price > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Planes de pago activos (cacheados 5 min). Con `fresh` ignora la caché. */
export async function getPlans({ fresh = false } = {}): Promise<Plan[]> {
  if (!fresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.plans;
  }
  try {
    const plans = await fetchPlans();
    cache = { plans, fetchedAt: Date.now() };
    return plans;
  } catch (err) {
    // Si la API falla pero hay caché, la usamos en lugar de romper el flujo.
    if (cache && !fresh) return cache.plans;
    throw err;
  }
}

export async function getPlan(id: number, opts?: { fresh?: boolean }): Promise<Plan | undefined> {
  return (await getPlans(opts)).find((p) => p.id === id);
}
