import type { FormattedEntity } from "../db/auto-replies.js";

const TYPES = new Set<string>(["bold", "italic", "underline", "strikethrough", "spoiler", "code", "blockquote", "text_link"]);
const LINK_PROTOCOLS = new Set(["http:", "https:", "tg:"]);

function isAllowedLink(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    return LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

const byPosition = (a: FormattedEntity, b: FormattedEntity) => a.offset - b.offset || b.length - a.length;

// Telegram requires entities to nest, so a style crossing the end of another is cut in two.
function nest(entities: FormattedEntity[]): FormattedEntity[] {
  const list = [...entities].sort(byPosition);
  for (let i = 0; i < list.length; i++) {
    const end = list[i]!.offset + list[i]!.length;
    for (let j = i + 1; j < list.length; j++) {
      const other = list[j]!;
      const otherEnd = other.offset + other.length;
      if (other.offset < end && otherEnd > end) {
        list[j] = { ...other, length: end - other.offset };
        list.push({ ...other, offset: end, length: otherEnd - end });
        return nest(list);
      }
    }
  }
  return list;
}

export function normalizeFormatted(text: string, entities: FormattedEntity[]): { text: string; entities: FormattedEntity[] } | null {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const clipped: FormattedEntity[] = [];
  for (const entity of entities) {
    const { type, offset, length, url } = entity;
    if (!TYPES.has(type) || !Number.isInteger(offset) || !Number.isInteger(length)) return null;
    if (offset < 0 || length < 1 || offset + length > text.length) return null;
    if (type === "text_link" && !isAllowedLink(url)) return null;
    const start = Math.max(offset - lead, 0);
    const end = Math.min(offset + length - lead, trimmed.length);
    if (end <= start) continue;
    clipped.push(type === "text_link" ? { type, offset: start, length: end - start, url } : { type, offset: start, length: end - start });
  }
  return { text: trimmed, entities: nest(clipped) };
}
