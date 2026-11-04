import type { MessageEntity } from "grammy/types";
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

const MASKED_TYPES = new Set(["mention", "text_mention", "url"]);

export function maskEntities(text: string, entities: MessageEntity[] | undefined): string {
  let out = text;
  for (const entity of entities ?? []) {
    if (!MASKED_TYPES.has(entity.type)) continue;
    out = out.slice(0, entity.offset) + " ".repeat(entity.length) + out.slice(entity.offset + entity.length);
  }
  return out;
}
