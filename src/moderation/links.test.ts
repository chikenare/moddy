import { expect, test } from "vitest";
import { extractLinks, findUnauthorizedLink, normalizeWhitelistEntry, type LinkSource } from "./links.js";

const src = (m: unknown) => m as LinkSource;

test("extrae url exacta aunque haya un emoji antes (offsets UTF-16)", () => {
  const text = "😀 mira https://spam.example/x fin";
  const offset = text.indexOf("https");
  expect(extractLinks(src({ text, entities: [{ type: "url", offset, length: 22 }] }))).toEqual(["https://spam.example/x"]);
});
test("extrae text_link, caption y botones", () => {
  expect(extractLinks(src({ text: "clic", entities: [{ type: "text_link", offset: 0, length: 4, url: "https://oculto.example" }] }))).toEqual(["https://oculto.example"]);
  expect(extractLinks(src({ caption: "a.example", caption_entities: [{ type: "url", offset: 0, length: 9 }] }))).toEqual(["a.example"]);
  expect(extractLinks(src({ reply_markup: { inline_keyboard: [[{ text: "x", url: "https://b.example" }]] } }))).toEqual(["https://b.example"]);
});
test("las menciones no son enlaces", () => {
  expect(extractLinks(src({ text: "@ana", entities: [{ type: "mention", offset: 0, length: 4 }] }))).toEqual([]);
});
test.each([
  ["https://www.Example.com/", "example.com"],
  ["t.me/MiCanal/", "t.me/micanal"],
  ["example.com/a?x=1#y", "example.com/a"],
  ["", null], ["no es dominio", null], ["localhost", null], ["javascript:alert(1)", null],
])("normalizeWhitelistEntry(%s)", (raw, expected) => {
  expect(normalizeWhitelistEntry(raw)).toBe(expected);
});
test.each([
  ["https://example.com/x", ["example.com"], undefined],
  ["sub.example.com", ["example.com"], undefined],
  ["EXAMPLE.com.", ["example.com"], undefined],
  ["example.com:8080/a", ["example.com"], undefined],
  ["example.com.evil.com", ["example.com"], "example.com.evil.com"],
  ["evil.com/example.com", ["example.com"], "evil.com/example.com"],
  ["https://example.com@evil.com", ["example.com"], "https://example.com@evil.com"],
  ["t.me/micanal/5", ["t.me/micanal"], undefined],
  ["https://spam.t.me/micanal", ["t.me/micanal"], "https://spam.t.me/micanal"],
  ["spam.t.me/micanal/5", ["t.me/micanal"], "spam.t.me/micanal/5"],
  ["sub.example.com/x", ["example.com"], undefined],
  ["https://www.instagram.com/micuenta/", ["instagram.com/micuenta"], undefined],
  ["https://www.instagram.com/micuenta/reel/1", ["instagram.com/micuenta"], undefined],
  ["www.t.me/micanal/5", ["t.me/micanal"], undefined],
  ["www.spam.t.me/micanal", ["t.me/micanal"], "www.spam.t.me/micanal"],
  ["t.me/micanal2", ["t.me/micanal"], "t.me/micanal2"],
  ["t.me/otro", ["t.me/micanal"], "t.me/otro"],
  ["https://", ["example.com"], "https://"],
  ["a.example", [], "a.example"],
])("findUnauthorizedLink(%s, %j)", (link, list, expected) => {
  expect(findUnauthorizedLink([link], list)).toBe(expected);
});
