import { Cron } from "croner";

const MIN_GAP_SECONDS = 5 * 60;
const PREVIEW_RUNS = 5;

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
  const nextRuns: number[] = [];
  let at = now;
  while (nextRuns.length < PREVIEW_RUNS) {
    const next = nextRun(cron, timezone, at);
    if (next === null) break;
    nextRuns.push(next);
    at = next;
  }
  if (!nextRuns.length) return { error: "This schedule never runs" };
  for (let i = 1; i < nextRuns.length; i++) {
    if (nextRuns[i]! - nextRuns[i - 1]! < MIN_GAP_SECONDS) return { error: "Messages can't repeat more often than every 5 minutes" };
  }
  return { nextRuns };
}
