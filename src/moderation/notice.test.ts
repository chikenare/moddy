import { expect, test } from "vitest";
import { renderNotice, safeName } from "./notice.js";

const TEMPLATE = "User {user} {action}: {reason}.";
const sender = (name: string) => ({ id: 42, name });

test.each([
  ["banned", "link", "User Ana banned: unauthorized link."],
  ["simulated", "word", "User Ana banned (simulated): banned word."],
  ["warned", "flood", "User Ana warned: repeated messages."],
  ["banned", "bot", "User Ana banned: unauthorized bot."],
] as const)("renders %s with reason %s", (outcome, filter, expected) => {
  expect(renderNotice(TEMPLATE, { sender: sender("Ana"), filter, outcome })).toBe(expected);
});

test("replaces every occurrence and leaves everything else alone", () => {
  const text = renderNotice("{user}, {user} {other} $& {reason}", { sender: sender("Ana"), filter: "word", outcome: "banned" });
  expect(text).toBe("Ana, Ana {other} $& banned word");
});

test("a name with braces or replacement patterns is not expanded", () => {
  const text = renderNotice("{user} {reason}", { sender: sender("{reason} $1"), filter: "word", outcome: "banned" });
  expect(text).toBe("{reason} $1 banned word");
});

test.each([
  "buy at t.me/xxx",
  "spam.com",
  "SPAM.COM deal",
  "https://x.example",
  "@spam_channel",
  "win ｔ．ｍｅ",
  "   ",
])("a link-like or empty name falls back to the id: %j", (name) => {
  expect(safeName(sender(name))).toBe("42");
});

test("cleans line breaks and control characters", () => {
  expect(safeName(sender("Ana\nMaría\u0000  López"))).toBe("Ana María López");
});

test("shortens long names without splitting an emoji", () => {
  const name = safeName(sender(`${"a".repeat(39)}😀😀`));
  expect(name).toBe(`${"a".repeat(39)}😀…`);
});

test("keeps normal names with accents and emoji", () => {
  expect(safeName(sender("José Ñandú 😀"))).toBe("José Ñandú 😀");
});
