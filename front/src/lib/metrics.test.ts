import { expect, test } from "vitest";
import { delta, formatCount, hasActivity, niceMax, ruleHits, shortDay } from "./metrics";
import type { StatTotals } from "./api";

const zero = (o: Partial<StatTotals> = {}): StatTotals => ({
  messages: 0, joins: 0, leaves: 0, deleted: 0, banned: 0, link_hits: 0, word_hits: 0, flood_hits: 0, bot_hits: 0,
  auto_replies: 0, broadcasts: 0, ...o,
});

test("delta compares with the previous period", () => {
  expect(delta(150, 100)).toEqual({ direction: "up", text: "50%" });
  expect(delta(50, 100)).toEqual({ direction: "down", text: "50%" });
  expect(delta(3, 3)).toEqual({ direction: "flat", text: "No change" });
  expect(delta(0, 0)).toEqual({ direction: "flat", text: "No change" });
  expect(delta(4, 0)).toEqual({ direction: "new", text: "New" });
  expect(delta(0, 4)).toEqual({ direction: "down", text: "100%" });
  expect(delta(1001, 1000)).toEqual({ direction: "up", text: "<1%" });
});

test("formats counts in full under 10,000 and compact above", () => {
  expect(formatCount(9999)).toBe("9,999");
  expect(formatCount(12_900)).toBe("12.9K");
});

test("short days are read in UTC", () => {
  expect(shortDay("2026-11-04")).toBe("Nov 4");
});

test("sums rule hits and detects an empty period", () => {
  expect(ruleHits(zero({ link_hits: 1, word_hits: 2, flood_hits: 3, bot_hits: 4, deleted: 99 }))).toBe(10);
  expect(hasActivity(zero())).toBe(false);
  expect(hasActivity(zero({ broadcasts: 1 }))).toBe(true);
});

test("niceMax gives round axis ends", () => {
  expect(niceMax(0)).toBe(4);
  expect(niceMax(7)).toBe(8);
  expect(niceMax(37)).toBe(40);
  expect(niceMax(101)).toBe(200);
  expect(niceMax(1000)).toBe(1000);
});
