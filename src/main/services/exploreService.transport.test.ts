import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSession } from './accountSession'
import { ApiAdmissionController } from './adapters/ApiAdmissionController'
import { VrcAdapter, type VrcCredentialStore } from './adapters/VrcAdapter'
import { markVrcSessionEstablished } from './adapters/__testutils__/adapterTestKit'
import { AvatarCache } from './avatarCache'
import { ExploreService } from './exploreService'
import { JoinCoordinator } from './joinCoordinator'

const worldId = (index: number): string =>
  `wrld_00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
const imageUrl = (index: number): string =>
  `https://api.vrchat.cloud/api/1/image/file_${index}/1/256`
const store: VrcCredentialStore = {
  load: () => 'auth=synthetic',
  save: () => undefined,
  delete: () => undefined
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ExploreService real transport accounting', () => {
  it('shares one admission lane with VrcAdapter and AvatarCache; six redirected images stay within 18 physical fetches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const starts: Array<{ url: string; at: number }> = []
    const admission = new ApiAdmissionController({
      minimumIntervalMs: 1_000,
      random: () => 0
    })
    const adapter = new VrcAdapter(store, admission)
    markVrcSessionEstablished(adapter)
    const account = new AccountSession()
    account.setIdentity('vrchat', 'account')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      starts.push({ url, at: Date.now() })
      if (url.includes('/worlds/active'))
        return new Response(
          JSON.stringify(
            Array.from({ length: 6 }, (_, index) => ({
              id: worldId(index),
              name: `W${index}`,
              thumbnailImageUrl: imageUrl(index),
              occupants: index
            }))
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
      if (url.includes('/auth/user'))
        return new Response(JSON.stringify({ id: 'user1', displayName: 'A' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      if (url.includes('/image/file_'))
        return new Response(null, {
          status: 302,
          headers: { Location: `https://api.vrchat.cloud/api/1/image/hop_${url.split('/').at(-3)}` }
        })
      if (url.includes('/image/hop_'))
        return new Response(null, {
          status: 302,
          headers: { Location: `https://cdn.example.test/${url.split('/').at(-3)}.png` }
        })
      if (url.startsWith('https://cdn.example.test/'))
        return new Response('image', { headers: { 'Content-Type': 'image/png' } })
      return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const cache = new AvatarCache({
      fetchFn: fetchMock,
      apiAdmission: admission,
      vrcSessionProvider: () => adapter.getAvatarRequestLease()
    })
    const service = new ExploreService({
      adapters: new Map([['vrchat', adapter]]),
      accountSession: account,
      admissions: new Map([['vrchat', admission]]),
      joinCoordinator: new JoinCoordinator(Date.now),
      isJoinAllowed: () => true,
      getImage: (url) => cache.get(url),
      openExternal: async () => undefined,
      onChanged: () => undefined,
      clock: Date.now,
      wallClock: Date.now
    })
    service.setActive(['vrchat'])
    const normal = adapter.getAuthStatus()
    await service.getSnapshot('vrchat', 'manual')
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(async () =>
      expect((await service.getSnapshot('vrchat', 'snapshot')).status).toBe('ready')
    )
    const worlds = (await service.getSnapshot('vrchat', 'snapshot')).worlds
    for (const world of worlds) {
      const image = service.getImage('vrchat', world.worldRef)
      await vi.advanceTimersByTimeAsync(2_000)
      await image
    }
    await expect(normal).resolves.toMatchObject({ state: 'authenticated' })
    expect(starts.filter(({ url }) => url.includes('/auth/user'))).toHaveLength(1)
    const imageFetches = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.includes('/image/') || url.includes('cdn.example.test')
    })
    expect(worlds).toHaveLength(6)
    expect(imageFetches.length).toBeLessThanOrEqual(18)
    expect(imageFetches.length).toBe(18)
    const apiStarts = starts.filter(({ url }) => url.includes('api.vrchat.cloud'))
    expect(
      apiStarts.every((value, index) => index === 0 || value.at - apiStarts[index - 1]!.at >= 1_000)
    ).toBe(true)
  })

  it('keeps two queued image operations outstanding across a window, then limits the later carryover window to 24 physical image fetches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const starts: Array<{ url: string; at: number }> = []
    const admission = new ApiAdmissionController({ minimumIntervalMs: 1_000, random: () => 0 })
    const adapter = new VrcAdapter(store, admission)
    markVrcSessionEstablished(adapter)
    const account = new AccountSession()
    account.setIdentity('vrchat', 'account')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      starts.push({ url, at: Date.now() })
      if (url.includes('/worlds/active'))
        return new Response(
          JSON.stringify(
            Array.from({ length: 9 }, (_, index) => ({
              id: worldId(index),
              name: `W${index}`,
              thumbnailImageUrl: imageUrl(index),
              occupants: index
            }))
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
      if (url.includes('/image/file_'))
        return new Response(null, {
          status: 302,
          headers: { Location: `https://api.vrchat.cloud/api/1/image/hop_${url.split('/').at(-3)}` }
        })
      if (url.includes('/image/hop_'))
        return new Response(null, {
          status: 302,
          headers: { Location: `https://cdn.example.test/${url.split('/').at(-3)}.png` }
        })
      if (url.startsWith('https://cdn.example.test/'))
        return new Response('image', { headers: { 'Content-Type': 'image/png' } })
      return new Response(JSON.stringify({ id: 'user1', displayName: 'A' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const cache = new AvatarCache({
      fetchFn: fetchMock,
      apiAdmission: admission,
      vrcSessionProvider: () => adapter.getAvatarRequestLease()
    })
    const service = new ExploreService({
      adapters: new Map([['vrchat', adapter]]),
      accountSession: account,
      admissions: new Map([['vrchat', admission]]),
      joinCoordinator: new JoinCoordinator(Date.now),
      isJoinAllowed: () => true,
      getImage: (url) => cache.get(url),
      openExternal: async () => undefined,
      onChanged: () => undefined,
      clock: Date.now,
      wallClock: Date.now
    })
    service.setActive(['vrchat'])
    await service.getSnapshot('vrchat', 'manual')
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(async () =>
      expect((await service.getSnapshot('vrchat', 'snapshot')).status).toBe('ready')
    )
    const worlds = (await service.getSnapshot('vrchat', 'snapshot')).worlds
    const blocked = admission.acquire({ notBefore: Date.now() + 60_001 })
    await Promise.resolve()
    const oldOne = service.getImage('vrchat', worlds[0]!.worldRef)
    const oldTwo = service.getImage('vrchat', worlds[1]!.worldRef)
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(service.getImage('vrchat', worlds[2]!.worldRef)).resolves.toMatchObject({
      ok: false,
      reason: 'deferred'
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await blocked
    await Promise.all([oldOne, oldTwo])
    for (const world of worlds.slice(2, 8)) {
      const image = service.getImage('vrchat', world.worldRef)
      await vi.advanceTimersByTimeAsync(4_000)
      await image
    }
    await expect(service.getImage('vrchat', worlds[8]!.worldRef)).resolves.toMatchObject({
      ok: false,
      reason: 'deferred'
    })
    const imageStarts = starts.filter(
      ({ url }) => url.includes('/image/') || url.includes('cdn.example.test')
    )
    const later = imageStarts.filter(({ at }) => at >= 60_000 && at < 120_000)
    expect(imageStarts).toHaveLength(24)
    expect(later).toHaveLength(24)
    expect(starts.filter(({ url }) => url.includes('/worlds/active'))).toHaveLength(1)
  })
})
