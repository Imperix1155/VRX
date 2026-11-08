import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONCURRENCY_LIMIT } from '@shared/constants'
import { type AdapterEvent, Friend } from '@shared/types'
import { VrcAdapter } from './VrcAdapter'
import { AuthError } from './errors'
import {
  jsonResponse,
  markVrcSessionEstablished as markSessionEstablished,
  instantAdmission
} from './__testutils__/adapterTestKit'
import { AccountSession } from '../accountSession'
import { applyFriendEvent } from '../../../renderer/src/utils/applyFriendEvent'
import { WorldResolver } from './vrchat/WorldResolver'
import {
  fakeStore,
  creds,
  DrivableVrcSocket,
  pipelineFrame,
  pipelineUser
} from './__testutils__/vrcAdapterTestKit'

async function runDeferredWorldMetadataRace(liveMutation: 'offline' | 'location'): Promise<{
  cache: Friend[]
  targetAfterLive: Friend
  resolutionEvents: AdapterEvent[]
}> {
  const worldId = 'wrld_held'
  const movedWorldId = 'wrld_moved'
  const targetId = 'usr_target'
  const sameWorldId = 'usr_same_world'
  const worldMeta = {
    name: 'Held World',
    thumbnailImageUrl: 'https://example.com/held.jpg',
    capacity: 20,
    shortName: null
  }
  let releaseWorld!: (response: Response) => void
  let released = false
  const heldWorld = new Promise<Response>((resolve) => {
    releaseWorld = resolve
  })
  let worldRequested = false
  const sockets: DrivableVrcSocket[] = []
  const wireFriend = (
    id: string,
    displayName: string,
    instanceId: string
  ): Record<string, unknown> => ({
    id,
    displayName,
    currentAvatarThumbnailImageUrl: null,
    status: 'active',
    statusDescription: null,
    tags: [],
    location: `${worldId}:${instanceId}`
  })
  const fetchMock = vi.fn((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
    if (href.includes('/auth/user/friends')) {
      return Promise.resolve(
        jsonResponse(
          href.includes('offline=true')
            ? []
            : [
                wireFriend(targetId, 'Target Friend', 'target-instance'),
                wireFriend(sameWorldId, 'Same World Friend', 'other-instance')
              ]
        )
      )
    }
    if (href.includes(`/worlds/${worldId}`)) {
      worldRequested = true
      return heldWorld
    }
    if (href.endsWith('/auth/user')) {
      return Promise.resolve(
        jsonResponse({
          id: 'usr_self',
          displayName: 'Self',
          onlineFriends: [targetId, sameWorldId],
          activeFriends: [],
          offlineFriends: []
        })
      )
    }
    return Promise.reject(new Error(`Unexpected URL: ${href}`))
  })
  vi.stubGlobal('fetch', fetchMock)

  let cache: Friend[] = []
  const events: AdapterEvent[] = []
  const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
    socketFactory: () => {
      const socket = new DrivableVrcSocket()
      sockets.push(socket)
      return socket
    }
  })
  markSessionEstablished(adapter)
  const unsubscribe = adapter.subscribe((event) => {
    events.push(event)
    if (event.type !== 'inbox') cache = applyFriendEvent(cache, event)
  })

  try {
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const socket = sockets[0]!
    socket.fire('open')
    cache = (await adapter.getFriends()).friends
    await vi.waitFor(() => expect(worldRequested).toBe(true))

    if (liveMutation === 'offline') {
      socket.fire('message', pipelineFrame('friend-offline', { userId: targetId }))
    } else {
      socket.fire(
        'message',
        pipelineFrame('friend-location', {
          userId: targetId,
          user: {
            ...pipelineUser,
            id: targetId,
            displayName: 'Target Friend',
            status: 'ask me'
          },
          location: `${movedWorldId}:new-instance`
        })
      )
    }
    const targetAfterLive = cache.find((friend) => friend.platformUserId === targetId)
    if (targetAfterLive === undefined) throw new Error('live mutation did not reach the cache')
    const resolutionEventIndex = events.length

    releaseWorld(jsonResponse(worldMeta))
    released = true
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(resolutionEventIndex))

    return {
      cache,
      targetAfterLive,
      resolutionEvents: events.slice(resolutionEventIndex)
    }
  } finally {
    if (!released) releaseWorld(jsonResponse(worldMeta))
    unsubscribe()
  }
}

describe('VrcAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getFriends', () => {
    it('getFriends returns a normalized friend list (VRX-43)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 'usr_00000001',
              displayName: 'Alice',
              currentAvatarThumbnailImageUrl: null,
              status: 'active',
              statusDescription: null,
              tags: []
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      // /auth/user for buckets: return empty buckets + no friends in any bucket
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: [],
            activeFriends: [],
            offlineFriends: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      // online page (1 friend)
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'usr_00000001',
              displayName: 'Alice',
              currentAvatarThumbnailImageUrl: null,
              status: 'active',
              statusDescription: null,
              tags: []
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      // offline page (empty — ends pass)
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

      const { friends } = await adapter.getFriends()
      expect(friends).toHaveLength(1)
      expect(friends[0]!.platform).toBe('vrchat')
      expect(friends[0]!.platformUserId).toBe('usr_00000001')
      expect(friends[0]!.displayName).toBe('Alice')
    })

    it('rejects a stale account-A roster and lets a fresh read use B without invalidation', async () => {
      let releaseAccountA!: (response: Response) => void
      const heldAccountA = new Promise<Response>((resolve) => {
        releaseAccountA = resolve
      })
      let accountAStarted = false
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'ACCOUNTB1', displayName: 'Account B' },
              { setCookies: ['auth=account-b'] }
            )
          )
        }
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=account-a') {
          accountAStarted = true
          return heldAccountA
        }
        if (href.endsWith('/auth/user')) {
          return Promise.resolve(
            jsonResponse({
              onlineFriends: ['usr_b_friend'],
              activeFriends: [],
              offlineFriends: []
            })
          )
        }
        if (href.includes('/auth/user/friends')) {
          return Promise.resolve(
            href.includes('offline=true')
              ? jsonResponse([])
              : jsonResponse([
                  {
                    id: 'usr_b_friend',
                    displayName: 'Account B Friend',
                    status: 'active',
                    tags: []
                  }
                ])
          )
        }
        return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission(), {
        onSessionBoundary: boundary
      })
      markSessionEstablished(adapter)

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(accountAStarted).toBe(true))
      expect(await adapter.login({ username: 'account-b', password: 'pw' })).toEqual({ ok: true })
      const boundariesAfterLogin = boundary.mock.calls.length
      releaseAccountA(jsonResponse({ error: 'expired account A' }, { status: 401 }))

      await expect(roster).rejects.toThrow('Session ended')
      await expect(adapter.getFriends()).resolves.toEqual({
        friends: [
          expect.objectContaining({
            platformUserId: 'usr_b_friend',
            displayName: 'Account B Friend'
          })
        ],
        completeness: 'complete'
      })
      expect(boundary).toHaveBeenCalledTimes(boundariesAfterLogin)
    })

    it('does not retry an old roster through a tentative replacement cookie', async () => {
      let releaseAccountA!: (response: Response) => void
      const heldAccountA = new Promise<Response>((resolve) => {
        releaseAccountA = resolve
      })
      let releaseLoginBody!: (body: unknown) => void
      const heldLoginBody = new Promise<unknown>((resolve) => {
        releaseLoginBody = resolve
      })
      const loginResponse = jsonResponse(null, { setCookies: ['auth=account-b'] })
      let loginBodyStarted = false
      vi.spyOn(loginResponse, 'json').mockImplementation(() => {
        loginBodyStarted = true
        return heldLoginBody
      })
      let accountAStarted = false
      let tentativeAccountBRequests = 0
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) return Promise.resolve(loginResponse)
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=account-a') {
          accountAStarted = true
          return heldAccountA
        }
        if (headers.Cookie === 'auth=account-b') {
          tentativeAccountBRequests += 1
          return Promise.reject(new Error('tentative account B request escaped'))
        }
        return Promise.reject(new Error(`Unexpected URL: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission())
      markSessionEstablished(adapter)

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(accountAStarted).toBe(true))
      const login = adapter.login({ username: 'account-b', password: 'pw' })
      await vi.waitFor(() => expect(loginBodyStarted).toBe(true))
      releaseAccountA(jsonResponse({ error: 'expired account A' }, { status: 401 }))
      const rosterError = await roster.then(
        () => null,
        (error: unknown) => error
      )
      releaseLoginBody({ id: 'ACCOUNTB1', displayName: 'Account B' })
      await expect(login).resolves.toEqual({ ok: true })

      expect(rosterError).toBeInstanceOf(Error)
      expect((rosterError as Error).message).toBe('Session ended')
      expect(tentativeAccountBRequests).toBe(0)
    })

    it('stops a roster before its next page can use a durable replacement cookie', async () => {
      let releaseAccountAPage!: (response: Response) => void
      const heldAccountAPage = new Promise<Response>((resolve) => {
        releaseAccountAPage = resolve
      })
      let accountAPageStarted = false
      const accountBPaths: string[] = []
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'ACCOUNTB1', displayName: 'Account B' },
              { setCookies: ['auth=account-b'] }
            )
          )
        }
        if (headers.Cookie === 'auth=account-a' && href.endsWith('/auth/user')) {
          return Promise.resolve(
            jsonResponse({
              onlineFriends: [],
              activeFriends: [],
              offlineFriends: []
            })
          )
        }
        if (
          headers.Cookie === 'auth=account-a' &&
          href.includes('/auth/user/friends') &&
          href.includes('offline=false')
        ) {
          accountAPageStarted = true
          return heldAccountAPage
        }
        if (headers.Cookie === 'auth=account-b') {
          const parsedUrl = new URL(href)
          accountBPaths.push(`${parsedUrl.pathname}${parsedUrl.search}`)
          if (parsedUrl.pathname.endsWith('/auth/user')) {
            return Promise.resolve(
              jsonResponse({
                onlineFriends: [],
                activeFriends: [],
                offlineFriends: []
              })
            )
          }
          if (parsedUrl.pathname.endsWith('/auth/user/friends')) {
            return Promise.resolve(jsonResponse([]))
          }
        }
        return Promise.reject(new Error(`Unexpected URL: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission())
      markSessionEstablished(adapter)

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(accountAPageStarted).toBe(true))
      await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
        ok: true
      })
      releaseAccountAPage(jsonResponse([]))
      await expect(roster).rejects.toThrow('Session ended')
      expect(accountBPaths).toEqual([])
      await expect(adapter.getFriends()).resolves.toEqual({ friends: [], completeness: 'complete' })

      expect(accountBPaths[0]).toBe('/api/1/auth/user')
    })

    it.each([
      {
        stage: 'while the replacement is tentative',
        loginBody: { requiresTwoFactorAuth: ['totp'] },
        expectedLogin: { needs2fa: true }
      },
      {
        stage: 'after the replacement is durable',
        loginBody: { id: 'ACCOUNTB1', displayName: 'Account B' },
        expectedLogin: { ok: true }
      }
    ])(
      'does not advance an old world-enrichment batch $stage',
      async ({ loginBody, expectedLogin }) => {
        const friendIds = Array.from(
          { length: CONCURRENCY_LIMIT + 1 },
          (_, index) => `usr_friend_${index}`
        )
        const releases: Array<(response: Response) => void> = []
        let accountAWorldRequests = 0
        let tentativeAccountBWorldRequests = 0
        const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (headers.Authorization !== undefined) {
            return Promise.resolve(jsonResponse(loginBody, { setCookies: ['auth=account-b'] }))
          }
          if (href.endsWith('/auth/user')) {
            return Promise.resolve(
              jsonResponse({
                onlineFriends: friendIds,
                activeFriends: [],
                offlineFriends: []
              })
            )
          }
          if (href.includes('/auth/user/friends')) {
            return Promise.resolve(
              href.includes('offline=true')
                ? jsonResponse([])
                : jsonResponse(
                    friendIds.map((id, index) => ({
                      id,
                      displayName: `Friend ${index}`,
                      status: 'active',
                      tags: [],
                      location: `wrld_pending_${index}:instance-${index}`
                    }))
                  )
            )
          }
          if (href.includes('/worlds/')) {
            if (headers.Cookie === 'auth=account-b') {
              tentativeAccountBWorldRequests += 1
              return Promise.resolve(
                jsonResponse({
                  name: 'Tentative world',
                  thumbnailImageUrl: null,
                  capacity: 16,
                  shortName: null
                })
              )
            }
            accountAWorldRequests += 1
            return new Promise<Response>((resolve) => releases.push(resolve))
          }
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
        vi.stubGlobal('fetch', fetchMock)
        const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission())
        markSessionEstablished(adapter)

        await expect(adapter.getFriends()).resolves.toMatchObject({ completeness: 'complete' })
        await vi.waitFor(() => expect(accountAWorldRequests).toBe(CONCURRENCY_LIMIT))
        await expect(
          adapter.login({ username: 'account-b', password: 'pw-b' })
        ).resolves.toMatchObject(expectedLogin)

        releases.shift()?.(
          jsonResponse({
            name: 'Account A world',
            thumbnailImageUrl: null,
            capacity: 16,
            shortName: null
          })
        )
        await new Promise((resolve) => setImmediate(resolve))
        const escapedRequests = tentativeAccountBWorldRequests
        for (const release of releases) {
          release(
            jsonResponse({
              name: 'Account A world',
              thumbnailImageUrl: null,
              capacity: 16,
              shortName: null
            })
          )
        }
        await new Promise((resolve) => setImmediate(resolve))

        expect(escapedRequests).toBe(0)
      }
    )

    it('aborts an in-flight roster after logout without retrying or double-invalidating', async () => {
      let releaseRoster!: (response: Response) => void
      const heldRoster = new Promise<Response>((resolve) => {
        releaseRoster = resolve
      })
      let rosterCalls = 0
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/auth')) {
          return Promise.resolve(jsonResponse({ token: 'account-a' }))
        }
        if (href.endsWith('/auth/user')) {
          rosterCalls += 1
          return heldRoster
        }
        return Promise.reject(new Error('unexpected roster retry'))
      })
      vi.stubGlobal('fetch', fetchMock)
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(rosterCalls).toBe(1))
      const unsubscribe = adapter.subscribe((event) => events.push(event))

      adapter.clearSession()
      releaseRoster(jsonResponse({ error: 'old session expired' }, { status: 401 }))

      await expect(roster).rejects.toThrow('Session ended')
      expect(rosterCalls).toBe(1)
      expect(events.filter((event) => event.type === 'auth-invalidated')).toEqual([
        { type: 'auth-invalidated', platform: 'vrchat' }
      ])
      unsubscribe()
    })

    it('throws (not a misleading empty list) when all friend fetches fail (VRX-43)', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)
      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
      // A missing presence probe is an explicit degraded result. Do not fetch
      // pages and manufacture an all-offline roster from empty buckets.
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('a 401 on the buckets probe EMITS auth-invalidated so the renderer re-checks auth (VRX-195/197)', async () => {
      // VRChat parity with CVR: a data-path 401 (dead cookie / expired 2FA) must
      // surface as auth-invalidated so the renderer quarantines + re-checks auth,
      // not silently degrade to an empty roster. The buckets probe is /auth/user.
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
    })

    it('marks a data-path 401 boundary as identity-retaining, unlike a login', async () => {
      // The renderer treats identity-boundary as an account switch (it refetches
      // the roster and drops note drafts). A data-path 401 keeps the account, so
      // main must be able to tell the two apart.
      const accountSession = new AccountSession()
      const boundaries: Array<{ identityRetained: boolean }> = []
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} }),
        onIdentity: (accountId) => accountSession.setIdentity('vrchat', accountId),
        onSessionBoundary: (boundary) => boundaries.push(boundary)
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      )
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
      adapter.subscribe((e) => events.push(e))
      boundaries.length = 0

      // Only the roster read is rejected; the pipeline's token exchange is not under test.
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            url.endsWith('/auth')
              ? jsonResponse({ token: 'tok' })
              : jsonResponse({ error: 'x' }, { status: 401 })
          )
        )
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(AuthError)
      expect(boundaries).toEqual([{ identityRetained: true }])
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
      expect(accountSession.getAccountId('vrchat')).toBe('ACCOUNT001')

      boundaries.length = 0
      adapter.clearSession()
      expect(boundaries).toEqual([{ identityRetained: false }])
    })

    it('a 403 on the buckets probe does NOT emit auth-invalidated (ordinary denial on a live session, VRX-42)', async () => {
      // Same 401-only boundary rule as selfInvite: BaseAdapter classifies 403s
      // as AuthError too, but a 403 must never read as a dead session.
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(AuthError)
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)
    })

    it('a 5xx on the buckets probe does NOT emit auth-invalidated (session still valid)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'oops' }, { status: 500 }))
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)
    })

    it('accepts a well-formed grouped-UUID canonical id (positive pin for the tightened regex)', async () => {
      // Response bodies are single-use — return a fresh Response per call
      // (login + getAuthStatus both read one).
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            jsonResponse(
              { id: 'usr_2f8698e3-4bd6-4a30-8c3f-0d2c1a94f60e', displayName: 'Neo' },
              { setCookies: ['auth=abc123'] }
            )
          )
        )
      )
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())
      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect((await adapter.getAuthStatus()).accountId).toBe(
        'usr_2f8698e3-4bd6-4a30-8c3f-0d2c1a94f60e'
      )
    })

    it('one malformed record does not kill the page OR the circuit (audit W4)', async () => {
      // End-to-end through the real request<T> path: before W4, one bad record
      // failed the page's array schema → NetworkError + a circuit-breaker failure
      // recorded — data drift poisoned the transport layer.
      const goodFriend = {
        id: 'usr_00000001',
        displayName: 'Alice',
        status: 'active',
        tags: []
      }
      const fetchMock = vi
        .fn()
        // buckets
        .mockResolvedValueOnce(
          jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
        )
        // online page: one good, one malformed (no displayName) — partial page ends pass
        .mockResolvedValueOnce(jsonResponse([goodFriend, { id: 'usr_bad' }]))
        // offline page: empty — ends pass
        .mockResolvedValueOnce(jsonResponse([]))
        // second getFriends call (circuit-state probe): buckets + pages again
        .mockResolvedValueOnce(
          jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
        )
        .mockResolvedValueOnce(jsonResponse([goodFriend]))
        .mockResolvedValueOnce(jsonResponse([]))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      const result = await adapter.getFriends()
      const { friends } = result

      expect(friends).toHaveLength(1)
      expect(friends[0]!.displayName).toBe('Alice')
      expect(result.completeness).toBe('partial')

      // The circuit must NOT have recorded the drifted record as a failure: a
      // follow-up call still reaches the wire (an open circuit would throw
      // 'Circuit open' before fetching).
      await expect(adapter.getFriends().then((result) => result.friends)).resolves.toHaveLength(1)
    })

    it('transport failures (non-array body) still trip the circuit breaker (audit W4)', async () => {
      // The flip side of the drift claim: a 200 whose body is NOT an array is a
      // transport-level problem — request<T> throws, records circuit failures,
      // and after 3 consecutive the breaker opens, so the offline pass fails
      // instantly with no extra wire hits. Total fetches: 1 buckets + 3 pages.
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends'))
          return Promise.resolve(jsonResponse({ error: 'drift' }))
        return Promise.resolve(
          jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('throws when every record is malformed (drift must not look like "no friends")', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
        )
        .mockResolvedValueOnce(jsonResponse([{ totally: 'wrong' }, { also: 'wrong' }]))
        .mockResolvedValueOnce(jsonResponse([]))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
    })

    it('held world metadata cannot resurrect a friend taken offline by the pipeline', async () => {
      const result = await runDeferredWorldMetadataRace('offline')
      const target = result.cache.find((friend) => friend.platformUserId === 'usr_target')
      const sameWorld = result.cache.find((friend) => friend.platformUserId === 'usr_same_world')

      expect(result.targetAfterLive).toMatchObject({
        presence: { state: 'offline' },
        status: null,
        instance: null
      })
      expect(target).toBe(result.targetAfterLive)
      expect(target).toMatchObject({
        presence: { state: 'offline' },
        status: null,
        instance: null
      })
      expect(sameWorld?.instance).toMatchObject({
        worldId: 'wrld_held',
        instanceId: 'other-instance',
        worldName: 'Held World',
        thumbnailUrl: 'https://example.com/held.jpg'
      })
      expect(result.resolutionEvents).toEqual([
        {
          type: 'world-metadata',
          platform: 'vrchat',
          worldId: 'wrld_held',
          worldName: 'Held World',
          thumbnailUrl: 'https://example.com/held.jpg'
        }
      ])
    })

    it('held world metadata cannot revert a pipeline location move', async () => {
      const result = await runDeferredWorldMetadataRace('location')
      const target = result.cache.find((friend) => friend.platformUserId === 'usr_target')
      const sameWorld = result.cache.find((friend) => friend.platformUserId === 'usr_same_world')

      expect(result.targetAfterLive).toMatchObject({
        presence: { state: 'in-game' },
        status: 'ask-me',
        instance: {
          worldId: 'wrld_moved',
          instanceId: 'new-instance'
        }
      })
      expect(target).toBe(result.targetAfterLive)
      expect(target).toMatchObject({
        presence: { state: 'in-game' },
        status: 'ask-me',
        instance: {
          worldId: 'wrld_moved',
          instanceId: 'new-instance'
        }
      })
      expect(sameWorld?.instance).toMatchObject({
        worldId: 'wrld_held',
        instanceId: 'other-instance',
        worldName: 'Held World',
        thumbnailUrl: 'https://example.com/held.jpg'
      })
      expect(result.resolutionEvents).toEqual([
        {
          type: 'world-metadata',
          platform: 'vrchat',
          worldId: 'wrld_held',
          worldName: 'Held World',
          thumbnailUrl: 'https://example.com/held.jpg'
        }
      ])
    })

    it('returns before world enrichment and emits one metadata-only event on resolution', async () => {
      const worldId = 'wrld_abc123'
      const worldMeta = {
        name: 'The Grid',
        thumbnailImageUrl: 'https://example.com/thumb.jpg',
        capacity: 20,
        shortName: null
      }
      let releaseWorld!: (response: Response) => void
      const heldWorld = new Promise<Response>((resolve) => {
        releaseWorld = resolve
      })
      let worldRequested = false
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          const isOffline = url.includes('offline=true')
          if (isOffline) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              })
            )
          }
          // online friends page — one friend in a world
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 'usr_111',
                  displayName: 'Bob',
                  currentAvatarThumbnailImageUrl: null,
                  status: 'active',
                  statusDescription: null,
                  tags: [],
                  location: `${worldId}:11111~private(usr_self)`
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        }
        if (url.includes(`/worlds/${worldId}`)) {
          worldRequested = true
          return heldWorld
        }
        // /auth/user — buckets
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'usr_self',
              displayName: 'Self',
              onlineFriends: ['usr_111'],
              activeFriends: [],
              offlineFriends: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const unsubscribe = adapter.subscribe((event) => events.push(event))
      let friends: Friend[] | undefined
      const roster = adapter.getFriends().then((result) => {
        friends = result.friends
        return result
      })

      await vi.waitFor(() => expect(worldRequested).toBe(true))
      try {
        expect(friends).toBeDefined()
        expect(friends![0]!.instance?.worldName).toBeNull()
        expect(friends![0]!.instance?.thumbnailUrl).toBeNull()
      } finally {
        releaseWorld(jsonResponse(worldMeta))
        await roster
      }

      // Wait for ARRIVAL, then settle two macrotask turns before pinning the
      // exact contents: `waitFor(toEqual([one]))` passes the instant the first
      // event lands, so a stray second emission a tick later would go
      // undetected — exactly what "one event" must rule out (CodeRabbit).
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(events.filter((event) => event.type === 'world-metadata')).toEqual([
        {
          type: 'world-metadata',
          platform: 'vrchat',
          worldId,
          worldName: 'The Grid',
          thumbnailUrl: 'https://example.com/thumb.jpg'
        }
      ])
      unsubscribe()
    })

    it('overlapping getFriends calls do not double-fetch an in-flight world', async () => {
      // peek() stays undefined until a resolve COMPLETES, so without the
      // pendingWorldResolutions guard a second getFriends during the held
      // window would re-fetch the same world through the shared 1 req/s slot
      // and emit a duplicate world-metadata event (CodeRabbit, VRX-214).
      const worldId = 'wrld_dedup1'
      let releaseWorld!: (response: Response) => void
      const heldWorld = new Promise<Response>((resolve) => {
        releaseWorld = resolve
      })
      let worldFetches = 0
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          const isOffline = url.includes('offline=true')
          if (isOffline) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              })
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 'usr_111',
                  displayName: 'Bob',
                  currentAvatarThumbnailImageUrl: null,
                  status: 'active',
                  statusDescription: null,
                  tags: [],
                  location: `${worldId}:11111~private(usr_self)`
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        }
        if (url.includes(`/worlds/${worldId}`)) {
          worldFetches += 1
          return heldWorld
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'usr_self',
              displayName: 'Self',
              onlineFriends: ['usr_111'],
              activeFriends: [],
              offlineFriends: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const unsubscribe = adapter.subscribe((event) => events.push(event))

      const first = adapter.getFriends()
      await vi.waitFor(() => expect(worldFetches).toBe(1))
      // Overlapping call while the world fetch is still held in flight.
      const second = adapter.getFriends()
      await Promise.all([first, second])

      releaseWorld(
        new Response(
          JSON.stringify({
            name: 'Dedup World',
            thumbnailImageUrl: null,
            capacity: 8,
            shortName: null
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'world-metadata')).toHaveLength(1)
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(worldFetches).toBe(1)
      expect(events.filter((event) => event.type === 'world-metadata')).toHaveLength(1)
      unsubscribe()
    })

    it('a 401 during background world enrichment invalidates auth without rejecting the roster', async () => {
      // Buckets + friend pages succeed, then the session dies before /worlds/:id.
      // The world 401 must propagate (WorldResolver rethrows AuthError) up to
      // getFriends and emit — not be swallowed to null world metadata.
      const worldId = 'wrld_abc123'
      const events: AdapterEvent[] = []
      const fetchMock = vi.fn((url: string) => {
        if (url.includes(`/worlds/${worldId}`)) {
          return Promise.resolve(jsonResponse({ error: 'unauthorized' }, { status: 401 }))
        }
        if (url.includes('/auth/user/friends')) {
          if (url.includes('offline=true')) return Promise.resolve(jsonResponse([]))
          return Promise.resolve(
            jsonResponse([
              {
                id: 'usr_111',
                displayName: 'Bob',
                currentAvatarThumbnailImageUrl: null,
                status: 'active',
                statusDescription: null,
                tags: [],
                location: `${worldId}:11111~private(usr_self)`
              }
            ])
          )
        }
        // /auth/user — buckets
        return Promise.resolve(
          jsonResponse({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: ['usr_111'],
            activeFriends: [],
            offlineFriends: []
          })
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      adapter.subscribe((e) => events.push(e))

      await expect(adapter.getFriends()).resolves.toEqual({
        friends: [
          expect.objectContaining({
            platformUserId: 'usr_111',
            instance: expect.objectContaining({ worldName: null, thumbnailUrl: null })
          })
        ],
        completeness: 'complete'
      })
      await vi.waitFor(() => {
        expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
      })
    })

    it('leaves worldName null for a friend with no instance (VRX-163)', async () => {
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          const isOffline = url.includes('offline=true')
          if (isOffline) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              })
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 'usr_222',
                  displayName: 'Eve',
                  currentAvatarThumbnailImageUrl: null,
                  status: 'active',
                  statusDescription: null,
                  tags: [],
                  // no location → instance stays null
                  location: 'private'
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'usr_self',
              displayName: 'Self',
              onlineFriends: ['usr_222'],
              activeFriends: [],
              offlineFriends: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      const { friends } = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.instance).toBeNull()
    })

    it('resolver errors leave metadata null without rejecting getFriends or crashing', async () => {
      const worldId = 'wrld_deleted999'
      let worldRequests = 0
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          const isOffline = url.includes('offline=true')
          if (isOffline) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              })
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 'usr_333',
                  displayName: 'Carol',
                  currentAvatarThumbnailImageUrl: null,
                  status: 'active',
                  statusDescription: null,
                  tags: [],
                  location: `${worldId}:22222`
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        }
        if (url.includes(`/worlds/${worldId}`)) {
          worldRequests += 1
          return Promise.reject(new Error('world resolver offline'))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'usr_self',
              displayName: 'Self',
              onlineFriends: ['usr_333'],
              activeFriends: [],
              offlineFriends: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      const { friends } = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.instance?.worldName).toBeNull()
      expect(friends[0]!.instance?.worldId).toBe(worldId)
      await vi.waitFor(() => expect(worldRequests).toBe(1))
    })

    it('caches world metadata across getFriends calls (single resolver, VRX-163)', async () => {
      const worldId = 'wrld_cached1'
      const worldMeta = {
        name: 'Cached World',
        thumbnailImageUrl: null,
        capacity: 10,
        shortName: null
      }

      function onlineFriendResponse(): Response {
        return new Response(
          JSON.stringify([
            {
              id: 'usr_444',
              displayName: 'Dave',
              currentAvatarThumbnailImageUrl: null,
              status: 'active',
              statusDescription: null,
              tags: [],
              location: `${worldId}:33333`
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      function bucketsResponse(): Response {
        return new Response(
          JSON.stringify({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: ['usr_444'],
            activeFriends: [],
            offlineFriends: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      function emptyPage(): Response {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      function worldResponse(): Response {
        return new Response(JSON.stringify(worldMeta), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const worldFetchCount = { n: 0 }
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          return Promise.resolve(
            url.includes('offline=true') ? emptyPage() : onlineFriendResponse()
          )
        }
        if (url.includes(`/worlds/${worldId}`)) {
          worldFetchCount.n++
          return Promise.resolve(worldResponse())
        }
        return Promise.resolve(bucketsResponse())
      })
      vi.stubGlobal('fetch', fetchMock)
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablished(adapter)
      const unsubscribe = adapter.subscribe((event) => events.push(event))

      await adapter.getFriends()
      await vi.waitFor(() => {
        expect(events).toContainEqual({
          type: 'world-metadata',
          platform: 'vrchat',
          worldId,
          worldName: 'Cached World',
          thumbnailUrl: null
        })
      })
      const { friends: cachedFriends } = await adapter.getFriends()

      // The world was fetched only once because the resolver's TTL cache persists
      // across getFriends calls (single worldResolver field, not recreated per call).
      expect(worldFetchCount.n).toBe(1)
      expect(cachedFriends[0]!.instance?.worldName).toBe('Cached World')
      unsubscribe()
    })

    it('clears cached world metadata before adopting a durable replacement account', async () => {
      const worldId = 'wrld_account_scoped'
      const worldRequestCookies: Array<string | undefined> = []
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'ACCOUNTB1', displayName: 'Account B' },
              { setCookies: ['auth=account-b'] }
            )
          )
        }
        if (href.includes(`/worlds/${worldId}`)) {
          worldRequestCookies.push(headers.Cookie)
          return Promise.resolve(
            jsonResponse({
              name: headers.Cookie === 'auth=account-a' ? 'Account A World' : 'Account B World',
              thumbnailImageUrl: null,
              capacity: 8,
              shortName: null
            })
          )
        }
        return Promise.reject(new Error(`Unexpected URL: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission())
      markSessionEstablished(adapter)
      const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver

      await expect(resolver.resolve(worldId)).resolves.toMatchObject({ name: 'Account A World' })
      await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
        ok: true
      })

      expect(resolver.peek(worldId)).toBeUndefined()
      await expect(resolver.resolve(worldId)).resolves.toMatchObject({ name: 'Account B World' })
      expect(worldRequestCookies).toEqual(['auth=account-a', 'auth=account-b'])
    })

    it('does not let an old world completion erase the replacement generation pending marker', async () => {
      const worldId = 'wrld_pending_owner'
      const releases: Array<(response: Response) => void> = []
      const worldRequestCookies: Array<string | undefined> = []
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'ACCOUNTB1', displayName: 'Account B' },
              { setCookies: ['auth=account-b'] }
            )
          )
        }
        if (href.includes(`/worlds/${worldId}`)) {
          worldRequestCookies.push(headers.Cookie)
          return new Promise<Response>((resolve) => releases.push(resolve))
        }
        return Promise.reject(new Error(`Unexpected URL: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission())
      markSessionEstablished(adapter)
      const internal = adapter as unknown as {
        sessionGeneration: number
        pendingWorldResolutions: Set<string>
        kickWorldMetadata(friends: Friend[], generation: number): void
      }
      const friend = { instance: { worldId } } as Friend

      internal.kickWorldMetadata([friend], internal.sessionGeneration)
      await vi.waitFor(() => expect(worldRequestCookies).toEqual(['auth=account-a']))
      await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
        ok: true
      })
      internal.kickWorldMetadata([friend], internal.sessionGeneration)
      await vi.waitFor(() =>
        expect(worldRequestCookies).toEqual(['auth=account-a', 'auth=account-b'])
      )

      releases[0]!(jsonResponse({ name: 'Account A World', thumbnailImageUrl: null, capacity: 8 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      const replacementMarkerSurvived = internal.pendingWorldResolutions.has(worldId)

      releases[1]!(jsonResponse({ name: 'Account B World', thumbnailImageUrl: null, capacity: 8 }))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(replacementMarkerSurvived).toBe(true)
    })

    it('negative-cached world failures are not re-fetched during reconcile inside the 60s window', async () => {
      const worldId = 'wrld_negcache'
      let now = 0
      let worldRequests = 0
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/auth/user/friends')) {
          return Promise.resolve(
            url.includes('offline=true')
              ? new Response(JSON.stringify([]), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                })
              : new Response(
                  JSON.stringify([
                    {
                      id: 'usr_neg',
                      displayName: 'Neg',
                      currentAvatarThumbnailImageUrl: null,
                      status: 'active',
                      statusDescription: null,
                      tags: [],
                      location: `${worldId}:11111`
                    }
                  ]),
                  { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
          )
        }
        if (url.includes(`/worlds/${worldId}`)) {
          worldRequests += 1
          return Promise.reject(new Error('world offline'))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'usr_self',
              displayName: 'Self',
              onlineFriends: ['usr_neg'],
              activeFriends: [],
              offlineFriends: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      markSessionEstablished(adapter)

      // Inject a clock so we can advance the negative TTL deterministically.
      const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
      const originalClock = (resolver as unknown as { clock: () => number }).clock
      vi.spyOn(resolver as unknown as { clock: () => number }, 'clock').mockImplementation(() => {
        void originalClock
        return now
      })
      const resolveSpy = vi.spyOn(resolver, 'resolve')

      await adapter.getFriends()
      await vi.waitFor(() => expect(worldRequests).toBe(1))
      // Wait for the in-flight dedupe guard to clear so the test exercises the
      // negative-cache gate, not the pending-set guard.
      const pending = (adapter as unknown as { pendingWorldResolutions: Set<string> })
        .pendingWorldResolutions
      await vi.waitFor(() => expect(pending.has(worldId)).toBe(false))

      // Still inside the negative window: a reconcile must not re-kick.
      await adapter.getFriends()
      // Counting resolver.resolve catches a reverted gate even though the
      // resolver's own negative cache would swallow the second HTTP call.
      expect(resolveSpy).toHaveBeenCalledTimes(1)
      expect(worldRequests).toBe(1)

      // Advance past the 60s negative TTL: the next reconcile may retry.
      now = 61_000
      await adapter.getFriends()
      await vi.waitFor(() => expect(worldRequests).toBe(2))
      expect(resolveSpy).toHaveBeenCalledTimes(2)
    })
  })
})
