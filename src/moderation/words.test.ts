import { expect, test } from "vitest";
import { DEFAULT_WORDS } from "./default-words.js";
import { normalizeWord } from "./normalize.js";
import type { MessageEntity } from "grammy/types";
import { findBannedWord, maskEntities } from "./words.js";

test.each([
  ["mi computadora nueva", ["puta"], undefined],
  ["feliz año", ["ano"], undefined],
  ["un cono de helado", ["coño"], undefined],
  ["¡PUTAAAA!", ["puta"], "puta"],
  ["Vendo CÓDIGOS ya", ["codigos"], "codigos"],
  ["gana   dinero RÁPIDO hoy", ["gana dinero rapido"], "gana dinero rapido"],
  ["qué coño", ["coño"], "coño"],
])("findBannedWord(%s, %j)", (text, words, expected) => {
  expect(findBannedWord(text, words)).toBe(expected);
});

test.each([
  ["xdxdxd", ["xd"]],
  ["XDXDXD", ["xd"]],
  ["xdxd", ["xd"]],
  ["jaja xdxdxd ok", ["xd"]],
  ["xdddxddd", ["xd"]],
  ["putaputa", ["puta"]],
  ["¡PUTAAAPUTAAA!", ["puta"]],
])("a word repeated with nothing between counts: %s", (text, words) => {
  expect(findBannedWord(text, words)).toBe(words[0]);
});

test.each([
  ["sexdrive", ["xd"]],
  ["xdcc", ["xd"]],
  ["axd", ["xd"]],
  ["xdxdz", ["xd"]],
  ["zxdxd", ["xd"]],
  ["xdxd1", ["xd"]],
  ["xd1xd", ["xd"]],
  ["computadora", ["puta"]],
  ["disputaputa", ["puta"]],
])("a word glued to anything else still does not count: %s", (text, words) => {
  expect(findBannedWord(text, words)).toBeUndefined();
});

test("normalizeWord", () => {
  expect(normalizeWord("  Coño ")).toBe("coño");
  expect(normalizeWord("   ")).toBeNull();
  expect(normalizeWord("ab".repeat(51))).toBeNull();
});

test.each(["xxx", "aaa", "a"])("normalizeWord(%s) queda por debajo de 2 caracteres", (w) => {
  expect(normalizeWord(w)).toBeNull();
});

test("normalizeWord conserva palabras de 2 caracteres", () => {
  expect(normalizeWord("ok")).toBe("ok");
});

const ent = (type: string, offset: number, length: number) => ({ type, offset, length }) as MessageEntity;

test("maskEntities sustituye menciones y urls por espacios", () => {
  expect(maskEntities("@mierda_king dijo", [ent("mention", 0, 12)])).toBe("            " + " dijo");
  expect(maskEntities("sin entidades", undefined)).toBe("sin entidades");
});

test("una mención no activa la palabra, una url tampoco, el texto normal sí", () => {
  const mention = "@mierda_king dijo";
  expect(findBannedWord(maskEntities(mention, [ent("mention", 0, 12)]), ["mierda"])).toBeUndefined();
  const url = "mira https://x.com/puta-x";
  expect(findBannedWord(maskEntities(url, [ent("url", 5, 20)]), ["puta"])).toBeUndefined();
  const mixed = "qué mierda @ana";
  expect(findBannedWord(maskEntities(mixed, [ent("mention", 11, 4)]), ["mierda"])).toBe("mierda");
});

test("con un emoji antes, el rango UTF-16 enmascara lo correcto", () => {
  const text = "😀 @mierda_king";
  const offset = text.indexOf("@");
  const masked = maskEntities(text, [ent("mention", offset, 12)]);
  expect(masked).toHaveLength(text.length);
  expect(masked.startsWith("😀 ")).toBe(true);
  expect(masked.slice(offset).trim()).toBe("");
});

test("text_mention se enmascara y text_link no", () => {
  expect(maskEntities("Pepe puta", [ent("text_mention", 0, 4)])).toBe("     puta");
  expect(maskEntities("puta aquí", [ent("text_link", 0, 4)])).toBe("puta aquí");
});

test("la lista inicial ya está normalizada, sin duplicados ni términos ambiguos", () => {
  for (const w of DEFAULT_WORDS) expect(normalizeWord(w)).toBe(w);
  expect(new Set(DEFAULT_WORDS).size).toBe(DEFAULT_WORDS.length);
  expect(DEFAULT_WORDS).not.toContain("ano");
});
