import { expect, test } from 'vitest'
import { guardRoute, safeNext } from './next'

const to = (fullPath: string, options: { public?: boolean; next?: string; expired?: string } = {}) => ({
  fullPath,
  path: fullPath.split('?')[0]!,
  meta: { public: options.public },
  query: { next: options.next, expired: options.expired },
})
const LOGGED_OUT = { authenticated: false, mustChangePassword: false }
const LOGGED_IN = { authenticated: true, mustChangePassword: false }
const MUST_CHANGE = { authenticated: true, mustChangePassword: true }

test('after the API refused the session, login stays put even if the session check disagrees, so it cannot loop', () => {
  expect(guardRoute(to('/login?next=/groups&expired=1', { public: true, next: '/groups', expired: '1' }), LOGGED_IN)).toBe(true)
})

test('a private page opens with a session', () => {
  expect(guardRoute(to('/messages'), LOGGED_IN)).toBe(true)
})

test('a private page without a session goes to login and remembers where it was', () => {
  expect(guardRoute(to('/messages?x=1'), LOGGED_OUT)).toEqual({ path: '/login', query: { next: '/messages?x=1' } })
  expect(guardRoute(to('/'), LOGGED_OUT)).toEqual({ path: '/login', query: {} })
})

test('the login page opens without a session', () => {
  expect(guardRoute(to('/login', { public: true }), LOGGED_OUT)).toBe(true)
})

test('the login page with a session goes to a safe destination', () => {
  expect(guardRoute(to('/login', { public: true }), LOGGED_IN)).toBe('/')
  expect(guardRoute(to('/login?next=/groups', { public: true, next: '/groups' }), LOGGED_IN)).toBe('/groups')
  expect(guardRoute(to('/login?next=//evil.example', { public: true, next: '//evil.example' }), LOGGED_IN)).toBe('/')
})

test('with the initial password every page leads to changing it, and remembers where it was', () => {
  expect(guardRoute(to('/'), MUST_CHANGE)).toEqual({ path: '/change-password', query: {} })
  expect(guardRoute(to('/messages'), MUST_CHANGE)).toEqual({ path: '/change-password', query: { next: '/messages' } })
  expect(guardRoute(to('/change-password?next=/messages', { next: '/messages' }), MUST_CHANGE)).toBe(true)
})

test('changing the password is a private page anyone logged in can open', () => {
  expect(guardRoute(to('/change-password'), LOGGED_IN)).toBe(true)
  expect(guardRoute(to('/change-password'), LOGGED_OUT)).toEqual({ path: '/login', query: { next: '/change-password' } })
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
  ['the password page', '/change-password'],
  ['the password page with a query', '/change-password?next=/groups'],
])('goes home for %s', (_name, next) => {
  expect(safeNext(next)).toBe('/')
})

