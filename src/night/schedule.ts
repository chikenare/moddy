import type { NightMode, NightModeSettings, NightState } from "../db/night-mode.js";

const MINUTES_PER_DAY = 24 * 60;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (value: string) => TIME.test(value);

function minutesOf(time: string): number {
  const [, h, m] = TIME.exec(time)!;
  return Number(h) * 60 + Number(m);
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The wall clock in the zone, as a day count and minutes, so a night is compared in local time and DST needs nothing.
function localClock(at: number, timeZone: string): { day: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(at * 1000)).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return { day: Date.UTC(parts.year!, parts.month! - 1, parts.day!) / 86_400_000, minute: parts.hour! * 60 + parts.minute! };
}

/** Whether the schedule alone has the group closed at `at`. A night belongs to the day it starts. */
export function scheduledState(s: Pick<NightModeSettings, "enabled" | "closeTime" | "openTime" | "timezone" | "days">, at: number): NightState {
  if (!s.enabled) return "open";
  const close = minutesOf(s.closeTime);
  const open = minutesOf(s.openTime);
  const overnight = open <= close;
  const { day, minute } = localClock(at, s.timezone);
  const now = day * MINUTES_PER_DAY + minute;
  // Tonight, or a night that started yesterday and has not ended.
  for (const start of [day, day - 1]) {
    // Day 0 (1970-01-01) was a Thursday.
    if (!s.days.includes((start + 4) % 7)) continue;
    const from = start * MINUTES_PER_DAY + close;
    const until = (start + (overnight ? 1 : 0)) * MINUTES_PER_DAY + open;
    if (now >= from && now < until) return "closed";
  }
  return "open";
}

/** What the group should be now, and whether a manual close or open has run its course. */
export function desiredState(n: NightMode, at: number): { state: NightState; overrideDone: boolean } {
  const scheduled = scheduledState(n, at);
  if (n.override !== null && n.overrideSchedule === scheduled) return { state: n.override, overrideDone: false };
  return { state: scheduled, overrideDone: n.override !== null };
}
