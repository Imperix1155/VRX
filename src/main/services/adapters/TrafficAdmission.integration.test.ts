import { afterEach, expect, it, vi } from 'vitest'
import { AvatarCache } from '../avatarCache'
import { ApiAdmissionController } from './ApiAdmissionController'
import { CvrAdapter } from './CvrAdapter'
import { VrcAdapter } from './VrcAdapter'
import { markVrcSessionEstablished, jsonResponse } from './__testutils__/adapterTestKit'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shares VRC action retries and image hops while CVR authentication progresses independently', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const starts: Array<{ url: string; at: number; cookie: string | null }> = []
  let invites = 0
  const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    starts.push({ url, at: Date.now(), cookie: new Headers(options?.headers).get('Cookie') })
    if (url.includes('/invite/myself/')) {
      return ++invites === 1
        ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
        : jsonResponse({})
    }
    if (url.includes('/users/auth')) return jsonResponse({}, 401)
    if (url.includes('/api/1/image/'))
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://files.vrchat.cloud/fixture.png' }
      })
    return new Response('fixture-image', { headers: { 'Content-Type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const vrcAdmission = new ApiAdmissionController()
  const vrc = new VrcAdapter(
    { load: () => 'auth=fixture', save: () => {}, delete: () => {} },
    vrcAdmission
  )
  markVrcSessionEstablished(vrc)
  const cvr = new CvrAdapter(
    { load: () => undefined, save: () => {}, delete: () => {} },
    new ApiAdmissionController()
  )
  const cache = new AvatarCache({
    fetchFn: fetchMock,
    apiAdmission: vrcAdmission,
    vrcSessionProvider: () => vrc.getAvatarRequestLease()
  })

  const action = vrc.selfInvite('wrld_fixture:123~hidden(usr_fixture)')
  await vi.advanceTimersByTimeAsync(0)
  const image = cache.get('https://api.vrchat.cloud/api/1/image/file_fixture/1/256')
  const login = cvr.login({ username: 'fixture', password: 'fixture' })
  await vi.advanceTimersByTimeAsync(59_999)
  expect((await login).ok).toBe(false)
  expect(starts.map(({ at }) => at)).toEqual([10_000, 10_000])
  expect(starts[1]?.cookie).toBeNull()
  await vi.advanceTimersByTimeAsync(1_001)
  await expect(action).resolves.toBeUndefined()
  await expect(image).resolves.toMatch(/^data:image\/png;base64,/)
  expect(invites).toBe(2) // Existing bounded action retry, still paced and lease-owned.
  expect(starts.slice(2).map(({ at }) => at)).toEqual([70_000, 71_000, 71_000])
  expect(starts.at(-1)?.cookie).toBeNull()
  expect(vrcAdmission.pendingCount).toBe(0)
})
