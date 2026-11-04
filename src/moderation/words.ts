import { normalizeText } from "./normalize.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findBannedWord(text: string, words: string[]): string | undefined {
  const normalized = normalizeText(text);
  return words.find((word) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "u").test(normalized),
  );
}
