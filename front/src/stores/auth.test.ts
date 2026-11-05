import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { api } from '@/lib/api'
import { useAuthStore } from './auth'

vi.mock('@/lib/api', () => ({ api: { session: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn() } }))

const session = vi.mocked(api.session)
const LOGGED_OUT = { authenticated: false, mustChangePassword: false }

beforeEach(() => {
  vi.mocked(api.session).mockReset()
  vi.mocked(api.login).mockReset()
  vi.mocked(api.changePassword).mockReset()
  setActivePinia(createPinia())
})

test('a known answer is remembered', async () => {
  session.mockResolvedValue(LOGGED_OUT)
  const auth = useAuthStore()
  expect(await auth.check()).toEqual(LOGGED_OUT)
  expect(await auth.check()).toEqual(LOGGED_OUT)
  expect(session).toHaveBeenCalledOnce()
  expect(auth.unreachable).toBe(false)
})

test('an outage is not mistaken for being logged out, and the next check asks again', async () => {
  session.mockRejectedValueOnce(new Error('down'))
  const auth = useAuthStore()
  expect(await auth.check()).toEqual(LOGGED_OUT)
  expect(auth.authenticated).toBeNull()
  expect(auth.unreachable).toBe(true)

  session.mockResolvedValueOnce({ authenticated: true, mustChangePassword: false })
  expect((await auth.check()).authenticated).toBe(true)
  expect(auth.unreachable).toBe(false)
})

test('the session check reports a pending password change', async () => {
  session.mockResolvedValue({ authenticated: true, mustChangePassword: true })
  const auth = useAuthStore()
  expect(await auth.check()).toEqual({ authenticated: true, mustChangePassword: true })
  expect(await auth.check()).toEqual({ authenticated: true, mustChangePassword: true })
  expect(session).toHaveBeenCalledOnce()
})

test('logging in with the initial password keeps the change pending until it is done', async () => {
  vi.mocked(api.login).mockResolvedValue({ authenticated: true, mustChangePassword: true })
  vi.mocked(api.changePassword).mockResolvedValue({ authenticated: true, mustChangePassword: false })
  const auth = useAuthStore()
  await auth.login('admin', 'initial password')
  expect(auth.authenticated).toBe(true)
  expect(auth.mustChangePassword).toBe(true)
  await auth.changePassword('initial password', 'a brand new password')
  expect(api.changePassword).toHaveBeenCalledWith('initial password', 'a brand new password')
  expect(auth.mustChangePassword).toBe(false)
})

test('a failed change leaves it pending', async () => {
  vi.mocked(api.login).mockResolvedValue({ authenticated: true, mustChangePassword: true })
  vi.mocked(api.changePassword).mockRejectedValue(new Error('The current password is wrong'))
  const auth = useAuthStore()
  await auth.login('admin', 'initial password')
  await expect(auth.changePassword('wrong', 'a brand new password')).rejects.toThrow('wrong')
  expect(auth.mustChangePassword).toBe(true)
})
