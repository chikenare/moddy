import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { api } from '@/lib/api'
import { useAuthStore } from './auth'

vi.mock('@/lib/api', () => ({ api: { session: vi.fn(), login: vi.fn(), logout: vi.fn() } }))

const session = vi.mocked(api.session)

beforeEach(() => {
  session.mockReset()
  setActivePinia(createPinia())
})

test('a known answer is remembered', async () => {
  session.mockResolvedValue({ authenticated: false })
  const auth = useAuthStore()
  expect(await auth.check()).toBe(false)
  expect(await auth.check()).toBe(false)
  expect(session).toHaveBeenCalledOnce()
  expect(auth.unreachable).toBe(false)
})

test('an outage is not mistaken for being logged out, and the next check asks again', async () => {
  session.mockRejectedValueOnce(new Error('down'))
  const auth = useAuthStore()
  expect(await auth.check()).toBe(false)
  expect(auth.authenticated).toBeNull()
  expect(auth.unreachable).toBe(true)

  session.mockResolvedValueOnce({ authenticated: true })
  expect(await auth.check()).toBe(true)
  expect(auth.unreachable).toBe(false)
})
