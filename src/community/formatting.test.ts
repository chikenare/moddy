import { expect, test } from "vitest";
import type { FormattedEntity } from "../db/auto-replies.js";
import { normalizeFormatted } from "./formatting.js";

const e = (type: FormattedEntity["type"], offset: number, length: number, url?: string): FormattedEntity =>
  (url === undefined ? { type, offset, length } : { type, offset, length, url });

test("keeps every style the Telegram app offers", () => {
  const entities = [
    e("bold", 0, 2), e("italic", 0, 2), e("underline", 0, 2), e("strikethrough", 0, 2),
    e("spoiler", 0, 2), e("blockquote", 0, 2), e("text_link", 0, 2, "https://x.example"),
  ];
  expect(normalizeFormatted("Hi", entities)?.entities).toHaveLength(7);
  expect(normalizeFormatted("Hi", [e("code", 0, 2)])?.entities).toEqual([e("code", 0, 2)]);
});

test("plain text passes through", () => {
  expect(normalizeFormatted("Hi", [])).toEqual({ text: "Hi", entities: [] });
});

test("trimming the text moves the styles with it", () => {
  expect(normalizeFormatted("  Hi there  ", [e("bold", 2, 2), e("italic", 5, 5)])).toEqual({
    text: "Hi there",
    entities: [e("bold", 0, 2), e("italic", 3, 5)],
  });
});

test("a style over trimmed spaces is clipped, and one left empty is dropped", () => {
  expect(normalizeFormatted("  Hi  ", [e("bold", 0, 6)])?.entities).toEqual([e("bold", 0, 2)]);
  expect(normalizeFormatted("Hi   ", [e("bold", 3, 2)])?.entities).toEqual([]);
});

test("offsets count UTF-16 units, as Telegram does", () => {
  const text = "😀 hi";
  expect(text.slice(3, 5)).toBe("hi");
  expect(normalizeFormatted(text, [e("bold", 3, 2)])?.entities).toEqual([e("bold", 3, 2)]);
});

test.each<[string, FormattedEntity[]]>([
  ["past the end", [e("bold", 0, 3)]],
  ["starting past the end", [e("bold", 5, 1)]],
  ["negative offset", [e("bold", -1, 2)]],
  ["empty length", [e("bold", 0, 0)]],
  ["unknown type", [{ type: "mention", offset: 0, length: 2 } as unknown as FormattedEntity]],
  ["link without url", [e("text_link", 0, 2)]],
  ["javascript link", [e("text_link", 0, 2, "javascript:alert(1)")]],
  ["file link", [e("text_link", 0, 2, "file:///etc/passwd")]],
  ["unparsable link", [e("text_link", 0, 2, "not a url")]],
])("refuses %s", (_name, entities) => {
  expect(normalizeFormatted("Hi", entities)).toBeNull();
});

test.each(["https://x.example", "http://x.example", "tg://resolve?domain=x"])("accepts a %s link", (url) => {
  expect(normalizeFormatted("Hi", [e("text_link", 0, 2, url)])?.entities).toEqual([e("text_link", 0, 2, url)]);
});

test("a url on anything but a link is removed", () => {
  expect(normalizeFormatted("Hi", [e("bold", 0, 2, "https://x.example")])?.entities).toEqual([e("bold", 0, 2)]);
});

test("nested styles stay as they are, outermost first", () => {
  expect(normalizeFormatted("Hello", [e("italic", 1, 2), e("bold", 0, 5)])?.entities).toEqual([e("bold", 0, 5), e("italic", 1, 2)]);
});

test("styles that partly overlap are split, because Telegram requires nesting", () => {
  expect(normalizeFormatted("Hello there", [e("bold", 0, 5), e("italic", 3, 5)])?.entities).toEqual([
    e("bold", 0, 5), e("italic", 3, 2), e("italic", 5, 3),
  ]);
});

test("a chain of partial overlaps ends up fully nested", () => {
  const result = normalizeFormatted("abcdefghij", [e("bold", 0, 4), e("italic", 2, 4), e("underline", 4, 4)])!.entities;
  for (const a of result) {
    for (const b of result) {
      const partial = a.offset < b.offset && b.offset < a.offset + a.length && a.offset + a.length < b.offset + b.length;
      expect(partial).toBe(false);
    }
  }
  const covered = (type: FormattedEntity["type"]) => result.filter((x) => x.type === type).reduce((n, x) => n + x.length, 0);
  expect([covered("bold"), covered("italic"), covered("underline")]).toEqual([4, 4, 4]);
});
