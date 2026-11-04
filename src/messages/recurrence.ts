import { Cron } from "croner";

const MIN_GAP_SECONDS = 5 * 60;
const PREVIEW_RUNS = 5;
// Enough to cover several repeats of any hourly or daily pattern, so the verdict does not depend on the clock.
const CHECKED_RUNS = 300;

function fields(cron: string): string[] {
  return cron.trim().split(/\s+/).filter(Boolean);
}

export function nextRun(cron: string, timezone: string, after: number): number | null {
  try {
    const next = new Cron(cron, { timezone, paused: true }).nextRun(new Date(after * 1000));
    return next ? Math.floor(next.getTime() / 1000) : null;
  } catch {
    return null;
  }
}

export function validateRecurrence(cron: string, timezone: string, now: number): { error: string } | { nextRuns: number[] } {
  if (fields(cron).length !== 5) return { error: "Use 5 fields: minute, hour, day of month, month, weekday" };
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return { error: `Unknown time zone: ${timezone}` };
  }
  try {
    new Cron(cron, { timezone, paused: true });
  } catch (e) {
    return { error: `Invalid schedule: ${e instanceof Error ? e.message : String(e)}` };
  }
  const runs: number[] = [];
  let at = now;
  while (runs.length < CHECKED_RUNS) {
    const next = nextRun(cron, timezone, at);
    if (next === null) break;
    runs.push(next);
    at = next;
  }
  if (!runs.length) return { error: "This schedule never runs" };
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]! - runs[i - 1]! < MIN_GAP_SECONDS) return { error: "Messages can't repeat more often than every 5 minutes" };
  }
  const nextRuns = runs.slice(0, PREVIEW_RUNS);
  return { nextRuns };
}
