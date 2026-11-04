import { expect, test } from "vitest";
import { nextRun, validateRecurrence } from "./recurrence.js";

const at = (iso: string) => Date.parse(iso) / 1000;
const local = (ts: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts * 1000));

test("a daily 09:00 rule fires at 09:00 local time in Mexico City", () => {
  const next = nextRun("0 9 * * *", "America/Mexico_City", at("2026-01-10T00:00:00Z"))!;
  expect(local(next, "America/Mexico_City")).toBe("09:00");
  expect(next).toBe(at("2026-01-10T15:00:00Z"));
});

test("a daily 09:00 rule keeps its local hour across the New York daylight saving change", () => {
  const before = nextRun("0 9 * * *", "America/New_York", at("2026-03-07T00:00:00Z"))!;
  const after = nextRun("0 9 * * *", "America/New_York", before)!;
  expect(before).toBe(at("2026-03-07T14:00:00Z"));
  expect(after).toBe(at("2026-03-08T13:00:00Z"));
  expect(local(after, "America/New_York")).toBe("09:00");
});

test("nextRun is strictly after the reference", () => {
  const t = at("2026-01-10T15:00:00Z");
  expect(nextRun("0 9 * * *", "America/Mexico_City", t)).toBe(t + 86400);
});

test("nextRun returns null for an invalid rule", () => {
  expect(nextRun("nope", "UTC", 0)).toBeNull();
  expect(nextRun("0 9 * * *", "Mars/Base", 0)).toBeNull();
});

test("validate gives the next five runs for a good rule", () => {
  const r = validateRecurrence("*/5 * * * *", "UTC", at("2026-01-10T00:00:00Z"));
  expect(r).toEqual({ nextRuns: [300, 600, 900, 1200, 1500].map((s) => at("2026-01-10T00:00:00Z") + s) });
});

test.each([
  ["nope", "UTC", "Use 5 fields"],
  ["0 9 * * * *", "UTC", "Use 5 fields"],
  ["", "UTC", "Use 5 fields"],
  ["61 9 * * *", "UTC", "Invalid schedule"],
  ["0 9 * * *", "Mars/Base", "Unknown time zone"],
  ["* * * * *", "UTC", "every 5 minutes"],
  ["0,2 * * * *", "UTC", "every 5 minutes"],
])("validate refuses %j in %s", (cron, zone, message) => {
  const r = validateRecurrence(cron, zone, at("2026-01-10T00:00:00Z"));
  expect(r).toHaveProperty("error");
  expect((r as { error: string }).error).toContain(message);
});
