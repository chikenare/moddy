import { expect, test } from 'vitest'
import { avatarHue, initials, activeFilters } from './chats'

test('initials take up to two letters from the first words', () => {
  expect(initials('Team HUB')).toBe('TH')
  expect(initials('  test ')).toBe('T')
  expect(initials('')).toBe('?')
  expect(initials('🔥 Fuego')).toBe('F')
})

test('the avatar hue is stable per id and within the color wheel', () => {
  expect(avatarHue(-1001234567890)).toBe(avatarHue(-1001234567890))
  expect(avatarHue(-1)).not.toBe(avatarHue(-2))
  for (const id of [-1, -999001, -1009876543210, 0]) {
    const h = avatarHue(id)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
  }
})

test('activeFilters lists only enabled filters, and nothing when moderation is off', () => {
  const base = { moderationEnabled: true, linkFilterEnabled: true, wordFilterEnabled: false, floodFilterEnabled: true, botFilterEnabled: false, autoRepliesEnabled: true }
  expect(activeFilters(base)).toEqual(['link', 'flood'])
  expect(activeFilters({ ...base, moderationEnabled: false })).toEqual([])
})
