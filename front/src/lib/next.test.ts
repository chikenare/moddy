import { expect, test } from 'vitest'
import { guardRoute, safeNext } from './next'

const to = (fullPath: string, options: { public?: boolean; next?: string; expired?: string } = {}) => ({
  fullPath,
  meta: { public: options.public },
  query: { next: options.next, expired: options.expired },
})

test('after the API refused the session, login stays put even if the session check disagrees, so it cannot loop', () => {
  expect(guardRoute(to('/login?next=/groups&expired=1', { public: true, next: '/groups', expired: '1' }), true)).toBe(true)
})

test('a private page opens with a session', () => {
  expect(guardRoute(to('/messages'), true)).toBe(true)
})

test('a private page without a session goes to login and remembers where it was', () => {
  expect(guardRoute(to('/messages?x=1'), false)).toEqual({ path: '/login', query: { next: '/messages?x=1' } })
  expect(guardRoute(to('/'), false)).toEqual({ path: '/login', query: {} })
})

test('the login page opens without a session', () => {
  expect(guardRoute(to('/login', { public: true }), false)).toBe(true)
})

test('the login page with a session goes to a safe destination', () => {
  expect(guardRoute(to('/login', { public: true }), true)).toBe('/')
  expect(guardRoute(to('/login?next=/groups', { public: true, next: '/groups' }), true)).toBe('/groups')
  expect(guardRoute(to('/login?next=//evil.example', { public: true, next: '//evil.example' }), true)).toBe('/')
})

test.each(['/messages', '/groups', '/chats/-100', '/messages?x=1'])('keeps a path inside the panel: %s', (path) => {
  expect(safeNext(path)).toBe(path)
})

test.each([
  ['another site', 'https://evil.example'],
  ['a protocol-relative url', '//evil.example'],
  ['a backslash trick', '/\\evil.example'],
  ['a relative path', 'messages'],
  ['nothing', undefined],
  ['a repeated query value', ['/messages']],
  ['the login page', '/login'],
  ['the login page with a query', '/login?next=/messages'],
])('goes home for %s', (_name, next) => {
  expect(safeNext(next)).toBe('/')
})
