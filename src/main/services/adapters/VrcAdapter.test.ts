import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONCURRENCY_LIMIT } from '@shared/constants'
import { type AdapterEvent, Friend, InstanceInfo } from '@shared/types'
import { VrcAdapter } from './VrcAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { AuthError, RateLimitError } from './errors'
import {
  jsonResponse,
  markVrcSessionEstablished as markSessionEstablished,
  instantAdmission
} from './__testutils__/adapterTestKit'
import { AccountSession } from '../accountSession'
import { fakeStore, creds, DrivableVrcSocket } from './__testutils__/vrcAdapterTestKit'

describe('VRChat dispatch cancellation', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['world', 'group'] as const)(
    'invalidates a background %s 401 before another worker settles',
    async (kind) => {
      const adapter = new VrcAdapter(fakeStore('auth=synthetic'), instantAdmission())
      markSessionEstablished(adapter)
      const internal = adapter as unknown as {
        sessionGeneration: number
        worldResolver: { resolve(id: string): Promise<unknown> }
        groupResolver: { resolve(id: string): Promise<unknown> }
        emit(event: AdapterEvent): void
        kickWorldMetadata(friends: Friend[], generation: number): void
        kickGroupMetadata(friends: Friend[], generation: number): void
      }
      let release!: () => void
      const slow = new Promise<null>((resolve) => {
        release = () => resolve(null)
      })
      const resolver = kind === 'world' ? internal.worldResolver : internal.groupResolver
      const resolve = vi
        .spyOn(resolver, 'resolve')
        .mockReturnValueOnce(slow)
        .mockRejectedValueOnce(new AuthError('expired', 401))
        .mockResolvedValue(null)
      const events: AdapterEvent[] = []
      vi.spyOn(internal, 'emit').mockImplementation((event) => events.push(event))
      const generation = internal.sessionGeneration
      const friends = Array.from({ length: CONCURRENCY_LIMIT + 1 }, (_, i) => ({
        instance: { worldId: `wrld_${i}`, groupId: `grp_${i}` }
      })) as Friend[]
      if (kind === 'world') internal.kickWorldMetadata(friends, generation)
      else internal.kickGroupMetadata(friends, generation)
      await vi.waitFor(() =>
        expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
      )
      expect(internal.sessionGeneration).toBeGreaterThan(generation)
      expect(resolve.mock.calls.map(([id]) => id)).not.toContain(
        `${kind === 'world' ? 'wrld' : 'grp'}_${CONCURRENCY_LIMIT}`
      )
      release()
    }
  )

  it('coalesces simultaneous VRChat roster reads into one physical pagination', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse(
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).endsWith('/auth/user')
            ? { onlineFriends: [], activeFriends: [], offlineFriends: [] }
            : []
        )
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=a'), instantAdmission())
    markSessionEstablished(adapter)
    const results = await Promise.all(Array.from({ length: 20 }, () => adapter.getFriends()))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(results.every((result) => result === results[0])).toBe(true)
  })

  it.each(['online', 'offline'] as const)(
    'stops roster continuation after a shared immediate 429 during the %s page',
    async (stage) => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const admission = instantAdmission()
      let release!: (response: Response) => void
      const page = new Promise<Response>((resolve) => {
        release = resolve
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ onlineFriends: ['usr_friend'], activeFriends: [], offlineFriends: [] })
        )
      if (stage === 'offline') fetchMock.mockResolvedValueOnce(jsonResponse([]))
      fetchMock.mockReturnValueOnce(page).mockResolvedValue(jsonResponse([]))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=synthetic'), admission)
      markSessionEstablished(adapter)
      const internal = adapter as unknown as {
        kickWorldMetadata(friends: Friend[], generation: number): void
        kickGroupMetadata(friends: Friend[], generation: number): void
      }
      const world = vi.spyOn(internal, 'kickWorldMetadata').mockImplementation(() => {})
      const group = vi.spyOn(internal, 'kickGroupMetadata').mockImplementation(() => {})
      const request = adapter.getFriends()
      const expectedCalls = stage === 'online' ? 2 : 3
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls))
      admission.rateLimited('0')
      expect(admission.cooldownRemainingMs).toBe(0)
      release(
        jsonResponse([
          {
            id: 'usr_friend',
            displayName: 'Friend',
            status: 'active',
            tags: [],
            location: 'wrld_shared:instance~group(grp_shared)'
          }
        ])
      )
      const result = await request
      expect(fetchMock).toHaveBeenCalledTimes(expectedCalls)
      expect(result).toMatchObject({
        friends: [{ platformUserId: 'usr_friend' }],
        completeness: stage === 'online' ? 'partial' : 'complete',
        ...(stage === 'online' ? { rateLimit: { retryAfterMs: 0 } } : {})
      })
      expect(world).not.toHaveBeenCalled()
      expect(group).not.toHaveBeenCalled()
    }
  )

  it.each(['world', 'group'] as const)(
    'stops later %s workers after an immediate 429 from shared traffic',
    async (kind) => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const admission = instantAdmission()
      const adapter = new VrcAdapter(fakeStore('auth=synthetic'), admission)
      markSessionEstablished(adapter)
      const internal = adapter as unknown as {
        sessionGeneration: number
        worldResolver: { resolve(id: string): Promise<unknown> }
        groupResolver: { resolve(id: string): Promise<unknown> }
        pendingWorldResolutions: Set<string>
        pendingGroupResolutions: Set<string>
        kickWorldMetadata(friends: Friend[], generation: number): void
        kickGroupMetadata(friends: Friend[], generation: number): void
      }
      let release!: () => void
      const slow = new Promise<null>((resolve) => {
        release = () => resolve(null)
      })
      const resolver = kind === 'world' ? internal.worldResolver : internal.groupResolver
      const pending =
        kind === 'world' ? internal.pendingWorldResolutions : internal.pendingGroupResolutions
      const resolve = vi
        .spyOn(resolver, 'resolve')
        .mockReturnValueOnce(slow)
        .mockResolvedValue(null)
      const friends = Array.from({ length: CONCURRENCY_LIMIT + 1 }, (_, i) => ({
        instance: { worldId: `wrld_${i}`, groupId: `grp_${i}` }
      })) as Friend[]
      const kick = (): void => {
        if (kind === 'world') internal.kickWorldMetadata(friends, internal.sessionGeneration)
        else internal.kickGroupMetadata(friends, internal.sessionGeneration)
      }
      kick()
      admission.rateLimited('0')
      expect(admission.cooldownRemainingMs).toBe(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(resolve).toHaveBeenCalledTimes(CONCURRENCY_LIMIT)
      release()
      await vi.waitFor(() => expect(pending.size).toBe(0))
      kick()
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2 * CONCURRENCY_LIMIT + 1))
      await vi.waitFor(() => expect(pending.size).toBe(0))
    }
  )

  it.each(['world', 'group'] as const)(
    'retains failed %s batch ownership until active workers settle',
    async (kind) => {
      const adapter = new VrcAdapter(fakeStore('auth=synthetic'), instantAdmission())
      markSessionEstablished(adapter)
      const internal = adapter as unknown as {
        sessionGeneration: number
        worldResolver: { resolve(id: string): Promise<unknown> }
        groupResolver: { resolve(id: string): Promise<unknown> }
        pendingWorldResolutions: Set<string>
        pendingGroupResolutions: Set<string>
        kickWorldMetadata(friends: Friend[], generation: number): void
        kickGroupMetadata(friends: Friend[], generation: number): void
      }
      let release!: () => void
      const slow = new Promise<null>((resolve) => {
        release = () => resolve(null)
      })
      const resolver = kind === 'world' ? internal.worldResolver : internal.groupResolver
      const pending =
        kind === 'world' ? internal.pendingWorldResolutions : internal.pendingGroupResolutions
      const resolve = vi
        .spyOn(resolver, 'resolve')
        .mockReturnValueOnce(slow)
        .mockRejectedValueOnce(new RateLimitError(1))
        .mockResolvedValue(null)
      const friends = Array.from({ length: CONCURRENCY_LIMIT + 1 }, (_, i) => ({
        instance: { worldId: `wrld_${i}`, groupId: `grp_${i}` }
      })) as Friend[]
      const kick = (): void => {
        if (kind === 'world') internal.kickWorldMetadata(friends, internal.sessionGeneration)
        else internal.kickGroupMetadata(friends, internal.sessionGeneration)
      }
      kick()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(pending.size).toBe(CONCURRENCY_LIMIT + 1)
      kick()
      expect(resolve).toHaveBeenCalledTimes(CONCURRENCY_LIMIT)
      release()
      await vi.waitFor(() => expect(pending.size).toBe(0))
      expect(resolve).toHaveBeenCalledTimes(CONCURRENCY_LIMIT)
      kick()
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2 * CONCURRENCY_LIMIT + 1))
      await vi.waitFor(() => expect(pending.size).toBe(0))
    }
  )

  it('stops a physical roster batch on 429 and suppresses enrichment and repeat refreshes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.endsWith('/auth/user'))
        return Promise.resolve(
          jsonResponse({ onlineFriends: ['usr_0'], activeFriends: [], offlineFriends: [] })
        )
      if (href.includes('offset=0&') && href.includes('offline=false')) {
        return Promise.resolve(
          jsonResponse(
            Array.from({ length: 100 }, (_, i) => ({
              id: `usr_${i}`,
              displayName: `Friend ${i}`,
              location: 'wrld_test:123~group(grp_test)'
            }))
          )
        )
      }
      return Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const admission = instantAdmission()
    const adapter = new VrcAdapter(fakeStore('auth=a'), admission)
    markSessionEstablished(adapter)
    const roster = await adapter.getFriends()
    expect(roster.friends).toHaveLength(100)
    expect(roster).toMatchObject({
      completeness: 'partial',
      rateLimit: { retryAfterMs: expect.any(Number) }
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(admission.pendingCount).toBe(0)
    await expect(adapter.getFriends()).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('sends neither account cookie for an obsolete queued roster after switching', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const admission = new ApiAdmissionController()
    await admission.acquire()
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            { id: 'ACCOUNTB1', displayName: 'Account B' },
            { setCookies: ['auth=account-b'] }
          )
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=account-a'), admission)
    markSessionEstablished(adapter)
    const roster = adapter.getFriends().catch((error: unknown) => error)
    const login = adapter.login({ username: 'account-b', password: 'fake-b' })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(login).resolves.toEqual({ ok: true })
    expect(((await roster) as Error).message).toBe('Session ended')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Cookie')).toBeNull()
    expect(adapter.getAuthCookieHeader()).toBe('auth=account-b')
  })

  it('does not retry an action after logout during a server cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': '60' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=account-a'), admission)
    markSessionEstablished(adapter)
    const action = adapter
      .selfInvite('wrld_test:123~hidden(usr_owner)')
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await action).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(admission.pendingCount).toBe(0)
  })
  it('sends no queued roster or action after logout', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    admission.deferUntil(70_000)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=account-a'), admission)
    markSessionEstablished(adapter)
    const roster = adapter.getFriends().catch((error: unknown) => error)
    const action = adapter
      .selfInvite('wrld_test:123~hidden(usr_owner)')
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.pendingCount).toBe(0)
    await vi.advanceTimersByTimeAsync(65_000)
    expect(await roster).toBeInstanceOf(Error)
    expect(await action).toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(admission.pendingCount).toBe(0)
  })

  it('cancels a queued login when a later login supersedes it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const admission = new ApiAdmissionController()
    // An earlier request holds the request spacing, so the next login waits its turn.
    await admission.acquire()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}, 401)))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore(), admission)
    const first = adapter.login({ username: 'account-a', password: 'fake-a' })
    await vi.advanceTimersByTimeAsync(0)
    const second = adapter.login({ username: 'account-b', password: 'fake-b' })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(first).resolves.toMatchObject({ ok: false })
    await expect(second).resolves.toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from('account-b:fake-b').toString('base64')}`
    )
  })

  it('sends no login while a rate limit is cooling down, and says so', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    admission.deferUntil(20_000)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore(), admission)
    await expect(adapter.login(creds)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: 'rate_limited'
    })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('VrcAdapter', () => {
  it('rejects control-character direct credentials before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await new VrcAdapter(fakeStore(), instantAdmission()).login({
      username: 'neo\nadmin',
      password: 'redpill'
    })

    expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-printable auth cookie instead of persisting it', async () => {
    const response = jsonResponse({
      id: 'usr_12345678-1234-1234-1234-123456789abc',
      displayName: 'Neo'
    })
    vi.spyOn(response.headers, 'getSetCookie').mockReturnValue(['auth=session\npoison'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const store = fakeStore()

    const result = await new VrcAdapter(store, instantAdmission()).login(creds)

    expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    expect(store.saved).toEqual([])
  })

  it('allows Unicode direct-login credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { id: 'usr_12345678-1234-1234-1234-123456789abc', displayName: 'Neo' },
            { setCookies: ['auth=unicode-session'] }
          )
        )
    )

    await expect(
      new VrcAdapter(fakeStore(), instantAdmission()).login({
        username: 'ユーザー',
        password: '秘密🔐'
      })
    ).resolves.toEqual({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('AccountSession boundary ordering', () => {
    function wiring(
      accountSession: AccountSession,
      boundary = vi.fn()
    ): {
      onIdentity: (accountId: string | null) => void
      onSessionBoundary: () => void
    } {
      return {
        onIdentity: (accountId) => accountSession.setIdentity('vrchat', accountId),
        onSessionBoundary: () => {
          expect(accountSession.getAccountId('vrchat')).toBeNull()
          boundary()
        }
      }
    }

    it('clears AccountSession before a login-over-existing boundary', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'ACCOUNT002', displayName: 'Account B' },
              { setCookies: ['auth=account-b'] }
            )
          )
        }
        return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new VrcAdapter(
        fakeStore('auth=account-a'),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      expect(await adapter.getAuthStatus()).toMatchObject({ accountId: 'ACCOUNT001' })
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      expect(accountSession.getAccountId('vrchat')).toBe('ACCOUNT002')
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before logout', async () => {
      const accountSession = new AccountSession()
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(
              { id: 'ACCOUNT001', displayName: 'Account A' },
              { setCookies: ['auth=account-a'] }
            )
          )
      )
      const boundary = vi.fn()
      const adapter = new VrcAdapter(
        fakeStore(),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      await adapter.login(creds)
      expect(() => adapter.clearSession()).not.toThrow()
      expect(accountSession.getAccountId('vrchat')).toBeNull()
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before dead-cookie invalidation', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
        .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new VrcAdapter(
        fakeStore('auth=account-a'),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      await adapter.getAuthStatus()
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(accountSession.getAccountId('vrchat')).toBeNull()
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before the verifyTwoFactor boundary', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
        .mockResolvedValueOnce(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new VrcAdapter(
        fakeStore('auth=account-a'),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      await adapter.getAuthStatus()
      // #367: an expired second factor revokes the published identity at once,
      // not only when verifyTwoFactor starts.
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      expect(accountSession.getAccountId('vrchat')).toBeNull()
      await expect(adapter.verify2fa('123456')).resolves.toEqual({ ok: true })
      expect(accountSession.getAccountId('vrchat')).toBe('ACCOUNT001')
      expect(boundary).toHaveBeenCalledTimes(3)
    })

    it('revokes consumer authority when an established session needs 2FA again (#367)', async () => {
      const accountSession = new AccountSession()
      const store = fakeStore('auth=account-a; twoFactorAuth=old')
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
        .mockResolvedValue(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new VrcAdapter(store, instantAdmission(), wiring(accountSession, boundary))

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
      expect(adapter.getAuthCookieHeader()).not.toBeNull()
      expect(adapter.getAvatarRequestLease()).not.toBeNull()
      const deletedBefore = store.deleted

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'needs-2fa',
        twoFactorMethod: 'totp'
      })
      // Account-scoped authority is gone…
      expect(accountSession.getAccountId('vrchat')).toBeNull()
      expect(adapter.getAuthCookieHeader()).toBeNull()
      expect(adapter.getAvatarRequestLease()).toBeNull()
      expect(boundary).toHaveBeenCalledTimes(2)
      // …but the verification credential survives (no logout, no disk delete).
      expect(store.deleted).toBe(deletedBefore)

      // Repeated needs-2fa polls do not publish further boundaries.
      await adapter.getAuthStatus()
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('publishes no boundary when a restored cookie first needs 2FA at boot (#367)', async () => {
      const accountSession = new AccountSession()
      const store = fakeStore('auth=account-a; twoFactorAuth=old')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
      )
      const boundary = vi.fn()
      const adapter = new VrcAdapter(store, instantAdmission(), wiring(accountSession, boundary))
      const deletedBefore = store.deleted
      // Adopting the restored cookie is the only boundary so far.
      const boundariesAtBoot = boundary.mock.calls.length

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      // Nothing was ever published, so there is nothing to revoke.
      expect(boundary).toHaveBeenCalledTimes(boundariesAtBoot)
      expect(accountSession.getAccountId('vrchat')).toBeNull()
      expect(store.deleted).toBe(deletedBefore)
    })

    it('stops the live pipeline when an established session needs 2FA again (#367)', async () => {
      const sockets: DrivableVrcSocket[] = []
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/auth'))
          return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
        return Promise.resolve(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })
      markSessionEstablished(adapter)
      const unsubscribe = adapter.subscribe(() => {})
      try {
        await vi.waitFor(() => expect(sockets).toHaveLength(1))
        sockets[0]!.fire('open')

        await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
        expect(sockets[0]!.closed).toBe(true)
        // No replacement pipeline starts while the reprompt is pending.
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(sockets).toHaveLength(1)
      } finally {
        unsubscribe()
      }
    })

    it('restores consumer authority after the reprompt is verified (#367)', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
        .mockResolvedValueOnce(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(
        fakeStore('auth=account-a; twoFactorAuth=old'),
        instantAdmission(),
        wiring(accountSession)
      )

      await adapter.getAuthStatus()
      await adapter.getAuthStatus()
      expect(adapter.getAuthCookieHeader()).toBeNull()
      await expect(adapter.verify2fa('123456')).resolves.toEqual({ ok: true })
      expect(accountSession.getAccountId('vrchat')).toBe('ACCOUNT001')
      expect(adapter.getAuthCookieHeader()).toBe('auth=account-a; twoFactorAuth=fresh')
      expect(adapter.getAvatarRequestLease()).not.toBeNull()
    })
  })

  describe('join URL contract', () => {
    it('reuses the canonical URI and treats mode as a documented no-op', () => {
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())
      const instance = {
        worldId: 'wrld_abc123',
        instanceId: '12345~friends(usr_xyz)~region(us)',
        region: 'us'
      } as InstanceInfo
      expect(adapter.buildJoinUrl(instance, 'desktop')).toBe(
        'vrchat://launch?ref=vrchat.com&id=wrld_abc123:12345~friends(usr_xyz)~region(us)'
      )
      expect(adapter.buildJoinUrl(instance, 'vr')).toBe(adapter.buildJoinUrl(instance, 'desktop'))
    })
  })

  describe('selfInvite (VRX-51)', () => {
    // Full location string: worldId:nonce~accessTag (as documented in parseInstanceType.ts)
    const inviteLocation = 'wrld_abc123:11111~private(usr_xyz)'
    const publicLocation = 'wrld_abc123:22222'

    it('posts to the correct path with the raw location string (no encoding)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ type: 'invite' }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission())
      markSessionEstablished(adapter)

      await adapter.selfInvite(inviteLocation)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.vrchat.cloud/api/1/invite/myself/to/${inviteLocation}`)
      expect(opts.method).toBe('POST')
    })

    it('invites to a public instance too (Join uses it when VRChat is open)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ type: 'invite' }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission())
      markSessionEstablished(adapter)

      await adapter.selfInvite(publicLocation)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.vrchat.cloud/api/1/invite/myself/to/${publicLocation}`)
    })

    it('rejects with a generic error when the API call fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission())
      markSessionEstablished(adapter)

      await expect(adapter.selfInvite(inviteLocation)).rejects.toThrow()
      // The thrown error must not leak the instanceId / internal path
      try {
        await adapter.selfInvite(inviteLocation)
      } catch (err) {
        expect(String(err)).not.toContain(inviteLocation)
      }
    })

    it.each([
      '../../../auth/user#~private(usr_x)', // Codex gadget: fragment satisfies the public check, path is rewritten
      'wrld_abc:11111/../../auth', // path traversal via '/'
      'wrld_abc:11111?invite=all', // query injection
      'wrld_abc:11111#frag', // fragment
      'wrld_abc:11111 has space', // whitespace
      'wrld_abc:11111%2F..%2Fauth',
      'not-a-location' // missing wrld_ prefix
    ])('rejects unsafe/malformed location %j with NO API call (VRX-51 security)', async (bad) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission())
      markSessionEstablished(adapter)

      await expect(adapter.selfInvite(bad)).rejects.toThrow(/invalid instance location/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('emits auth-invalidated exactly once on a 401 (dead session) and still rejects', async () => {
      let authInvalidatedCount = 0
      const store = fakeStore('auth=tok')
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.includes('/invite/myself/to/')) {
          return Promise.resolve(jsonResponse({ error: 'expired' }, { status: 401 }))
        }
        return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(store, instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const generationBefore = (adapter as unknown as { sessionGeneration: number })
        .sessionGeneration
      adapter.subscribe((event) => {
        if (event.type === 'auth-invalidated') authInvalidatedCount += 1
      })

      await expect(adapter.selfInvite(inviteLocation)).rejects.toBeInstanceOf(AuthError)
      expect(authInvalidatedCount).toBe(1)
      expect(store.deleted).toBe(0)
      expect((adapter as unknown as { sessionGeneration: number }).sessionGeneration).toBe(
        generationBefore + 1
      )
    })

    it('does NOT emit auth-invalidated on a 403 (forbidden) and still rejects', async () => {
      let authInvalidatedCount = 0
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.includes('/invite/myself/to/')) {
          return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }))
        }
        return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const generationBefore = (adapter as unknown as { sessionGeneration: number })
        .sessionGeneration
      adapter.subscribe((event) => {
        if (event.type === 'auth-invalidated') authInvalidatedCount += 1
      })

      await expect(adapter.selfInvite(inviteLocation)).rejects.toBeInstanceOf(AuthError)
      expect(authInvalidatedCount).toBe(0)
      expect((adapter as unknown as { sessionGeneration: number }).sessionGeneration).toBe(
        generationBefore
      )
    })

    it('rejects a stale success as Session ended when the account changes mid-flight', async () => {
      let authInvalidatedCount = 0
      let releaseInvite!: (response: Response) => void
      const heldInvite = new Promise<Response>((resolve) => {
        releaseInvite = resolve
      })
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.includes('/invite/myself/to/')) {
          return heldInvite
        }
        return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)

      const invitePromise = adapter.selfInvite(inviteLocation)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
      adapter.clearSession()
      // Subscribe AFTER clearSession so its own auth-invalidated emit is not counted.
      adapter.subscribe((event) => {
        if (event.type === 'auth-invalidated') authInvalidatedCount += 1
      })
      releaseInvite(new Response(JSON.stringify({ type: 'invite' }), { status: 200 }))

      await expect(invitePromise).rejects.toThrow('Session ended')
      expect(authInvalidatedCount).toBe(0)
    })
  })
})
