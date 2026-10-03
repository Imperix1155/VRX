import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { VrcAdapter, type VrcLiveWiring } from './VrcAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { jsonResponse, ownerBindingHarness } from './__testutils__/adapterTestKit'

const buckets = { onlineFriends: ['friend'], activeFriends: [], offlineFriends: [] }
const user = { id: 'owner', displayName: 'Synthetic owner', ...buckets }
const friend = { id: 'friend', displayName: 'Synthetic friend', status: 'active' }

function requestPath(input: RequestInfo | URL): string {
  return (
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  ).replace('https://api.vrchat.cloud/api/1', '')
}

function setup(
  authBody: unknown = user,
  live?: VrcLiveWiring
): {
  adapter: VrcAdapter
  binding: ReturnType<typeof ownerBindingHarness<string>>
  requests: Array<{ path: string; at: number }>
  fetch: Mock<(input: RequestInfo | URL) => Promise<Response>>
  admission: ApiAdmissionController
} {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const requests: Array<{ path: string; at: number }> = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = requestPath(input)
    requests.push({ path, at: Date.now() })
    return jsonResponse(
      path === '/auth/user' ? authBody : path.includes('offline=false') ? [friend] : []
    )
  })
  vi.stubGlobal('fetch', fetch)
  const binding = ownerBindingHarness('auth=synthetic')
  const admission = new ApiAdmissionController({ random: () => 0 })
  const adapter = new VrcAdapter(binding.store, admission, live)
  return { adapter, binding, requests, fetch, admission }
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return promise
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('VRChat synthetic cold-start milestones', () => {
  it('reuses owner-validated auth buckets once and preserves one-second admission', async () => {
    const { adapter, binding, requests } = setup()
    expect((await settle(adapter.getAuthStatus())).state).toBe('authenticated')
    expect(binding.getOwner()).toBe('owner')
    const authReadyAt = Date.now()
    const roster = await settle(adapter.getFriends())
    expect(roster.friends[0]?.presence.state).toBe('in-game')
    expect(roster.completeness).toBe('complete')
    expect({
      authReadyAt,
      firstOnlineAt: requests.find((r) => r.path.includes('offline=false'))?.at,
      rosterReadyAt: Date.now()
    }).toEqual({
      authReadyAt: 0,
      firstOnlineAt: 1000,
      rosterReadyAt: 2000
    })
    expect(requests.map((r) => r.path)).toEqual([
      '/auth/user',
      '/auth/user/friends?offset=0&n=100&offline=false',
      '/auth/user/friends?offset=0&n=100&offline=true'
    ])
    await settle(adapter.getFriends())
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
    expect(requests.slice(1).every((r, i) => r.at - requests[i]!.at >= 1000)).toBe(true)
  })

  it.each([
    { id: 'owner', displayName: 'Synthetic owner' },
    { ...user, activeFriends: null }
  ])('falls back when auth bucket evidence is missing or malformed', async (body) => {
    const { adapter, requests, fetch } = setup(body)
    expect((await settle(adapter.getAuthStatus())).state).toBe('authenticated')
    fetch.mockImplementation(async (input) => {
      const path = requestPath(input)
      requests.push({ path, at: Date.now() })
      return jsonResponse(
        path === '/auth/user' ? buckets : path.includes('offline=false') ? [friend] : []
      )
    })
    const roster = await settle(adapter.getFriends())
    expect(roster.friends[0]?.presence.state).toBe('in-game')
    expect(Date.now()).toBe(3000)
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
  })

  it('does not reuse buckets after their five-second freshness window', async () => {
    const { adapter, requests } = setup()
    await settle(adapter.getAuthStatus())
    await vi.advanceTimersByTimeAsync(5001)
    await settle(adapter.getFriends())
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
  })

  it('does not retain buckets across an unsuccessful status revalidation', async () => {
    const { adapter, fetch, requests } = setup()
    await settle(adapter.getAuthStatus())
    fetch.mockResolvedValueOnce(jsonResponse({}, 503))
    expect((await settle(adapter.getAuthStatus())).state).toBe('error')
    await settle(adapter.getFriends())
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
  })

  it.each(['owner', 'replacement'])('does not borrow buckets after login as %s', async (id) => {
    const { adapter, fetch, requests } = setup()
    await settle(adapter.getAuthStatus())
    fetch.mockResolvedValueOnce(
      jsonResponse(
        { id, displayName: 'Synthetic replacement' },
        { setCookies: ['auth=replacement; Path=/'] }
      )
    )
    expect(await settle(adapter.login({ username: 'fixture', password: 'fixture' }))).toEqual({
      ok: true
    })
    await settle(adapter.getFriends())
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
  })

  it('does not renew bucket age when a slow auth response finishes', async () => {
    const { adapter, fetch, requests } = setup()
    fetch.mockImplementationOnce(async () => {
      requests.push({ path: '/auth/user', at: Date.now() })
      await new Promise((resolve) => setTimeout(resolve, 6000))
      return jsonResponse(user)
    })
    await settle(adapter.getAuthStatus())
    await settle(adapter.getFriends())
    expect(requests.filter((r) => r.path === '/auth/user')).toHaveLength(2)
  })

  it('keeps twenty simultaneous startup consumers on one physical roster', async () => {
    const { adapter, requests } = setup()
    await settle(adapter.getAuthStatus())
    const rosters = await settle(
      Promise.all(Array.from({ length: 20 }, () => adapter.getFriends()))
    )
    expect(rosters.every((roster) => roster === rosters[0])).toBe(true)
    expect(requests).toHaveLength(3)
  })

  it('honors a page 401 even when the auth bucket probe was reused', async () => {
    const { adapter, fetch } = setup()
    await settle(adapter.getAuthStatus())
    fetch.mockResolvedValueOnce(jsonResponse({}, 401))
    const failure = expect(adapter.getFriends()).rejects.toThrow()
    await vi.runAllTimersAsync()
    await failure
    expect(adapter.getAuthCookieHeader()).not.toBeNull()
    // The existing 2FA-aware status path, rather than borrowed buckets, decides recovery.
    fetch.mockResolvedValueOnce(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
    expect((await settle(adapter.getAuthStatus())).state).toBe('needs-2fa')
  })

  it('does not resurrect bucket evidence when an older status finishes after a newer error', async () => {
    const { adapter, fetch } = setup()
    await settle(adapter.getAuthStatus())
    let release!: (response: Response) => void
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const older = adapter.getAuthStatus()
    await vi.advanceTimersByTimeAsync(1000)
    fetch.mockResolvedValueOnce(jsonResponse({}, 503))
    expect((await settle(adapter.getAuthStatus())).state).toBe('error')
    release(jsonResponse(user))
    await settle(older)
    const callsBeforeRoster = fetch.mock.calls.length
    await settle(adapter.getFriends())
    expect(fetch.mock.calls.length - callsBeforeRoster).toBe(3)
  })

  it.each(['before', 'after'] as const)(
    'invalidates evidence on a Pipeline event %s status completion',
    async (when) => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      const { adapter, fetch } = setup(user, {
        socketFactory: () => ({
          on: (event, listener) => {
            listeners.set(event, listener)
          },
          close: () => {}
        })
      })
      await settle(adapter.getAuthStatus())
      const unsubscribe = adapter.subscribe(() => {})
      await vi.runAllTimersAsync()
      let release!: (response: Response) => void
      fetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve
          })
      )
      const status = adapter.getAuthStatus()
      await vi.advanceTimersByTimeAsync(1000)
      const event = (): void => {
        listeners.get('message')?.(
          JSON.stringify({
            type: 'friend-offline',
            content: JSON.stringify({ userId: 'friend' })
          })
        )
      }
      if (when === 'before') event()
      release(jsonResponse(user))
      await settle(status)
      if (when === 'after') event()
      const callsBeforeRoster = fetch.mock.calls.length
      await settle(adapter.getFriends())
      expect(fetch.mock.calls.length - callsBeforeRoster).toBe(3)
      unsubscribe()
    }
  )

  it('does not bypass a shared cooldown with reused buckets', async () => {
    const { adapter, admission, fetch } = setup()
    await settle(adapter.getAuthStatus())
    admission.rateLimited('60')
    await expect(adapter.getFriends()).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not expose a roster when restored-owner persistence fails', async () => {
    const { adapter, binding, requests } = setup()
    binding.failNextSave()
    expect((await settle(adapter.getAuthStatus())).state).toBe('unauthenticated')
    await expect(adapter.getFriends()).rejects.toThrow()
    expect(requests).toHaveLength(1)
    expect(binding.getOwner()).toBeNull()
  })
})
