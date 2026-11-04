import type { ChatRecord } from './api'

export function initials(title: string): string {
  const words = title.split(/\s+/).map((w) => Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch))).filter(Boolean) as string[]
  return words.slice(0, 2).join('').toUpperCase() || '?'
}

export function avatarHue(id: number): number {
  // Integer hash so neighboring ids still get different colors.
  let h = Math.abs(id) % 2147483647
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) % 360
}

type FilterFlags = Pick<ChatRecord, 'moderationEnabled' | 'linkFilterEnabled' | 'wordFilterEnabled' | 'floodFilterEnabled' | 'botFilterEnabled' | 'autoRepliesEnabled'>

/** Filters that are really acting: with moderation off none of them run. */
export function activeFilters(c: FilterFlags): string[] {
  if (!c.moderationEnabled) return []
  const out: string[] = []
  if (c.linkFilterEnabled) out.push('Links')
  if (c.wordFilterEnabled) out.push('Words')
  if (c.floodFilterEnabled) out.push('Flood')
  if (c.botFilterEnabled) out.push('Bots')
  return out
}
