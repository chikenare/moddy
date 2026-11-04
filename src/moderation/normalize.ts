const MIN_WORD_LENGTH = 2;
const MAX_WORD_LENGTH = 100;

export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/n\u0303/g, "\u00f1")
    .replace(/\p{M}/gu, "")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWord(raw: string): string | null {
  const word = normalizeText(raw);
  if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) return null;
  return word;
}
