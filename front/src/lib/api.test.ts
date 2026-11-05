import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, setUnauthorizedHandler } from './api'

const handler = vi.fn()

beforeEach(() => {
  handler.mockReset()
  setUnauthorizedHandler(handler)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a 401 from the API means the session ended', async () => {
  await expect(api.listChats()).rejects.toThrow('Not logged in')
  expect(handler).toHaveBeenCalledOnce()
})

test('a 401 while changing the password means the session ended', async () => {
  await expect(api.changePassword('current password', 'a brand new password')).rejects.toThrow()
  expect(handler).toHaveBeenCalledOnce()
})

test('a 401 at login only means a wrong password', async () => {
  await expect(api.login('admin', 'wrong')).rejects.toThrow()
  expect(handler).not.toHaveBeenCalled()
})

test('a 401 from the session check counts as an outage, or a proxy could make the page reload forever', async () => {
  await expect(api.session()).rejects.toThrow()
  expect(handler).not.toHaveBeenCalled()
})
