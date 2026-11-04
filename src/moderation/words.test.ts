import { expect, test } from "vitest";
import { DEFAULT_WORDS } from "./default-words.js";
import { normalizeWord } from "./normalize.js";
import { findBannedWord } from "./words.js";

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

test("normalizeWord", () => {
  expect(normalizeWord("  Coño ")).toBe("coño");
  expect(normalizeWord("   ")).toBeNull();
  expect(normalizeWord("ab".repeat(51))).toBeNull();
});

test("la lista inicial ya está normalizada, sin duplicados ni términos ambiguos", () => {
  for (const w of DEFAULT_WORDS) expect(normalizeWord(w)).toBe(w);
  expect(new Set(DEFAULT_WORDS).size).toBe(DEFAULT_WORDS.length);
  expect(DEFAULT_WORDS).not.toContain("ano");
});
