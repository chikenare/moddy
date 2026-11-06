import { describe, expect, test } from "vitest";
import { scheduledState } from "./schedule.js";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const at = (iso: string) => Date.parse(iso) / 1000;
const night = (o: Partial<Parameters<typeof scheduledState>[0]> = {}) => ({
  enabled: true, closeTime: "23:00", openTime: "07:00", timezone: "UTC", days: ALL, ...o,
});

describe("scheduledState", () => {
  test.each([
    ["before closing", "2026-11-04T22:59:00Z", "open"],
    ["at closing", "2026-11-04T23:00:00Z", "closed"],
    ["after midnight", "2026-11-05T03:00:00Z", "closed"],
    ["at opening", "2026-11-05T07:00:00Z", "open"],
    ["midday", "2026-11-05T12:00:00Z", "open"],
  ])("a night across midnight: %s", (_name, iso, state) => {
    expect(scheduledState(night(), at(iso))).toBe(state);
  });

  test("a window inside one day", () => {
    const lunch = night({ closeTime: "13:00", openTime: "15:00" });
    expect(scheduledState(lunch, at("2026-11-04T12:59:00Z"))).toBe("open");
    expect(scheduledState(lunch, at("2026-11-04T14:00:00Z"))).toBe("closed");
    expect(scheduledState(lunch, at("2026-11-04T15:00:00Z"))).toBe("open");
  });

  test("a night belongs to the day it starts", () => {
    // Only Friday night (5): Friday 23:00 to Saturday 07:00.
    const friday = night({ days: [5] });
    expect(scheduledState(friday, at("2026-11-05T23:30:00Z"))).toBe("open"); // Thursday night
    expect(scheduledState(friday, at("2026-11-06T23:30:00Z"))).toBe("closed"); // Friday night
    expect(scheduledState(friday, at("2026-11-07T06:59:00Z"))).toBe("closed"); // still Friday's night
    expect(scheduledState(friday, at("2026-11-07T23:30:00Z"))).toBe("open"); // Saturday night
  });

  test("uses the group's time zone, not UTC", () => {
    const mexico = night({ timezone: "America/Mexico_City" }); // UTC-6, no daylight saving
    expect(scheduledState(mexico, at("2026-11-05T04:30:00Z"))).toBe("open"); // 22:30 local
    expect(scheduledState(mexico, at("2026-11-05T05:30:00Z"))).toBe("closed"); // 23:30 local
    expect(scheduledState(mexico, at("2026-11-05T13:30:00Z"))).toBe("open"); // 07:30 local
  });

  test("keeps the local hour across a daylight saving change", () => {
    const madrid = night({ timezone: "Europe/Madrid" });
    // 23:30 local in summer (UTC+2) and in winter (UTC+1).
    expect(scheduledState(madrid, at("2026-07-01T21:30:00Z"))).toBe("closed");
    expect(scheduledState(madrid, at("2026-12-01T22:30:00Z"))).toBe("closed");
    expect(scheduledState(madrid, at("2026-12-01T21:30:00Z"))).toBe("open"); // 22:30 local
  });

  test("switched off is always open", () => {
    expect(scheduledState(night({ enabled: false }), at("2026-11-05T03:00:00Z"))).toBe("open");
  });
});
