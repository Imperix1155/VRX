import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import { CvrAdapter } from './CvrAdapter'
import { CVRAuthError } from './errors'
import { jsonResponse, instantAdmission } from './__testutils__/adapterTestKit'
import {
  fakeStore,
  authPayload,
  envelope,
  creds,
  markSessionEstablishedForTest
} from './__testutils__/cvrAdapterTestKit'

describe('CvrAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('getFriends (VRX-57 delegation, VRX-58 stitch)', () => {
    const sessioned = (): CvrAdapter =>
      markSessionEstablishedForTest(
        new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), instantAdmission())
      )

    it('returns the normalized static roster, presence offline until the pipeline updates', async () => {
      const roster = [
        {
          id: 'A1B2C3D4-0000-0000-0000-000000000001',
          name: 'Neo',
          imageUrl: 'https://cvr/a.png',
          categories: []
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          name: 'Trinity',
          imageUrl: null,
          categories: ['friends']
        }
      ]
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'ok', data: roster }))
      )
      const { friends } = await sessioned().getFriends()
      expect(friends).toHaveLength(2)
      expect(friends[0]).toMatchObject({ platform: 'chilloutvr', displayName: 'Neo' })
      expect(friends[0]?.presence.state).toBe('offline')
      // GUID normalized to lowercase (VRX-61) — stable across name changes.
      expect(friends[0]?.platformUserId).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    })

    it('marks a roster partial when malformed CVR records are skipped', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            message: 'ok',
            data: [
              {
                id: 'a1b2c3d4-0000-0000-0000-000000000001',
                name: 'Neo',
                imageUrl: null,
                categories: []
              },
              { id: 'not-a-guid', name: 'Unreadable', imageUrl: null, categories: [] }
            ]
          })
        )
      )

      await expect(sessioned().getFriends()).resolves.toMatchObject({
        friends: [{ platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001' }],
        completeness: 'partial'
      })
    })

    it('caches display names from the latest successful roster for id-only live snapshots', async () => {
      const adapter = sessioned()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            message: 'ok',
            data: [
              {
                id: 'A1B2C3D4-0000-0000-0000-000000000001',
                name: 'Neo',
                imageUrl: null,
                categories: []
              }
            ]
          })
        )
      )

      await adapter.getFriends()

      expect(adapter.resolveFriendName('a1b2c3d4-0000-0000-0000-000000000001')).toBe('Neo')
      expect(adapter.resolveFriendName('missing')).toBeNull()
    })

    it('rejects an account-A roster success after B is adopted and allows a fresh read', async () => {
      const accountAId = 'a1b2c3d4-0000-0000-0000-000000000001'
      const accountBId = 'a1b2c3d4-0000-0000-0000-000000000002'
      let releaseAccountARoster!: (response: Response) => void
      const accountARoster = new Promise<Response>((resolve) => {
        releaseAccountARoster = resolve
      })
      let friendsCalls = 0
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/friends')) {
          friendsCalls += 1
          if (friendsCalls === 1) return accountARoster
          return Promise.resolve(
            jsonResponse({
              message: 'ok',
              data: [{ id: accountBId, name: 'Account B Friend', imageUrl: null, categories: [] }]
            })
          )
        }
        return Promise.resolve(
          jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)

      const staleRoster = adapter.getFriends()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      releaseAccountARoster(
        jsonResponse({
          message: 'ok',
          data: [{ id: accountAId, name: 'Account A Friend', imageUrl: null, categories: [] }]
        })
      )
      await expect(staleRoster).rejects.toThrow('Session ended')
      expect(friendsCalls).toBe(1)
      await expect(adapter.getFriends()).resolves.toEqual({
        friends: [
          expect.objectContaining({
            platformUserId: accountBId,
            displayName: 'Account B Friend'
          })
        ],
        completeness: 'complete'
      })
      expect(adapter.resolveFriendName(accountAId)).toBeNull()
      expect(adapter.resolveFriendName(accountBId)).toBe('Account B Friend')
      expect(friendsCalls).toBe(2)
    })

    it('rejects a stale account-A 401 without clearing account B', async () => {
      const accountBId = 'a1b2c3d4-0000-0000-0000-000000000002'
      let releaseAccountARoster!: (response: Response) => void
      const accountARoster = new Promise<Response>((resolve) => {
        releaseAccountARoster = resolve
      })
      let friendsCalls = 0
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/friends')) {
          friendsCalls += 1
          if (friendsCalls === 1) return accountARoster
          return Promise.resolve(
            jsonResponse({
              message: 'ok',
              data: [{ id: accountBId, name: 'Account B Friend', imageUrl: null, categories: [] }]
            })
          )
        }
        return Promise.resolve(
          jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore({ username: 'account-a', accessKey: 'key-a' })
      const adapter = new CvrAdapter(store, instantAdmission())
      markSessionEstablishedForTest(adapter)

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(await adapter.login(creds)).toEqual({ ok: true })
      releaseAccountARoster(jsonResponse({ message: 'denied' }, { status: 401 }))

      await expect(roster).rejects.toThrow('Session ended')
      expect(friendsCalls).toBe(1)
      await expect(adapter.getFriends()).resolves.toEqual({
        friends: [
          expect.objectContaining({ platformUserId: accountBId, displayName: 'Account B Friend' })
        ],
        completeness: 'complete'
      })
      expect(store.deleted).toBe(0)
      expect((await adapter.getAuthStatus()).state).toBe('authenticated')
      expect(adapter.resolveFriendName(accountBId)).toBe('Account B Friend')
    })

    it('aborts an in-flight roster after logout without retrying or double-invalidating', async () => {
      let releaseRoster!: (response: Response) => void
      const heldRoster = new Promise<Response>((resolve) => {
        releaseRoster = resolve
      })
      const fetchMock = vi.fn(() => heldRoster)
      vi.stubGlobal('fetch', fetchMock)
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        instantAdmission(),
        { socketFactory: () => ({ on: () => {}, close: () => {} }) }
      )
      markSessionEstablishedForTest(adapter)
      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const unsubscribe = adapter.subscribe((event) => events.push(event))

      adapter.clearSession()
      releaseRoster(jsonResponse({ message: 'denied' }, { status: 401 }))

      await expect(roster).rejects.toThrow('Session ended')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(events.filter((event) => event.type === 'auth-invalidated')).toEqual([
        { type: 'auth-invalidated', platform: 'chilloutvr' }
      ])
      unsubscribe()
    })

    it('keeps the newest same-generation roster name cache when an older request settles last', async () => {
      const id = 'a1b2c3d4-0000-0000-0000-000000000001'
      let releaseOlder!: (response: Response) => void
      const older = new Promise<Response>((resolve) => {
        releaseOlder = resolve
      })
      let calls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          calls += 1
          return calls === 1
            ? older
            : Promise.resolve(
                jsonResponse({
                  message: 'ok',
                  data: [{ id, name: 'Newer roster name', imageUrl: null, categories: [] }]
                })
              )
        })
      )
      const adapter = sessioned()
      const read = (): Promise<import('./IPlatformAdapter').FriendRoster> =>
        (
          adapter as unknown as {
            readFriends(): Promise<import('./IPlatformAdapter').FriendRoster>
          }
        ).readFriends()

      const first = read()
      await vi.waitFor(() => expect(calls).toBe(1))
      await read()
      expect(adapter.resolveFriendName(id)).toBe('Newer roster name')

      releaseOlder(
        jsonResponse({
          message: 'ok',
          data: [{ id, name: 'Older roster name', imageUrl: null, categories: [] }]
        })
      )
      await first
      expect(adapter.resolveFriendName(id)).toBe('Newer roster name')
    })

    it('lets the only SUCCESSFUL roster populate names when a newer request failed', async () => {
      const id = 'a1b2c3d4-0000-0000-0000-000000000001'
      let releaseOlder!: (response: Response) => void
      const older = new Promise<Response>((resolve) => {
        releaseOlder = resolve
      })
      let calls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          calls += 1
          return calls === 1 ? older : Promise.reject(new TypeError('network down'))
        })
      )
      const adapter = sessioned()
      const read = (): Promise<import('./IPlatformAdapter').FriendRoster> =>
        (
          adapter as unknown as {
            readFriends(): Promise<import('./IPlatformAdapter').FriendRoster>
          }
        ).readFriends()

      const first = read()
      await vi.waitFor(() => expect(calls).toBe(1))
      await expect(read()).rejects.toThrow()

      // The newer request FAILED — a committed-sequence fence (not a started-
      // sequence one) must still allow the older success to land.
      releaseOlder(
        jsonResponse({
          message: 'ok',
          data: [{ id, name: 'Only successful roster', imageUrl: null, categories: [] }]
        })
      )
      await first
      expect(adapter.resolveFriendName(id)).toBe('Only successful roster')
    })

    it('throws rather than returning a misleading empty list when every entry is malformed', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ message: 'ok', data: [{ nope: true }, { alsoBad: 1 }] })
          )
      )
      await expect(sessioned().getFriends()).rejects.toThrow(/CVR friends/)
    })

    it('a 401 on getFriends clears the session — dead-key detection on the data path (VRX-190)', async () => {
      const store = fakeStore({ username: 'u', accessKey: 'k' })
      const adapter = new CvrAdapter(store, instantAdmission())
      markSessionEstablishedForTest(adapter)
      // getAuthStatus trusts the restored session; the DATA path is where a dead
      // key surfaces. A 401 on /friends must clear the session everywhere.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(store.deleted).toBe(1)
      expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
    })

    it('a TRANSIENT getFriends error (5xx) does NOT clear the session — only a 401 does (VRX-190)', async () => {
      const store = fakeStore({ username: 'u', accessKey: 'k' })
      const adapter = new CvrAdapter(store, instantAdmission())
      markSessionEstablishedForTest(adapter)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'oops' }, { status: 500 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(store.deleted).toBe(0) // a 5xx blip must not log the user out
    })

    it('a 401 on getFriends EMITS auth-invalidated so the renderer re-checks auth (VRX-195)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => ({ on: () => {}, close: () => {} })
        }
      )
      markSessionEstablishedForTest(adapter)
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
    })

    describe('a data-path 403 signs out only when a reauth is also rejected', () => {
      function routed(authResponses: Array<() => Promise<Response>>): ReturnType<typeof vi.fn> {
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (href.endsWith('/users/auth')) {
            const next = authResponses.shift()
            if (!next) throw new Error('unexpected reauth')
            return next()
          }
          return Promise.resolve(jsonResponse({ message: 'forbidden' }, { status: 403 }))
        })
        vi.stubGlobal('fetch', fetchMock)
        return fetchMock
      }

      function setup(): {
        adapter: CvrAdapter
        store: ReturnType<typeof fakeStore>
        events: AdapterEvent[]
      } {
        const events: AdapterEvent[] = []
        const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
        const adapter = new CvrAdapter(store, instantAdmission(), {
          socketFactory: () => ({ on: () => {}, close: () => {} })
        })
        markSessionEstablishedForTest(adapter)
        adapter.subscribe((e) => events.push(e))
        return { adapter, store, events }
      }

      function authCalls(fetchMock: ReturnType<typeof vi.fn>): number {
        return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/users/auth')).length
      }

      it('keeps the session when the same key still reauthenticates, and checks only once', async () => {
        const { adapter, store, events } = setup()
        const fetchMock = routed([() => Promise.resolve(jsonResponse(envelope(authPayload())))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() => expect(authCalls(fetchMock)).toBe(1))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(store.deleted).toBe(0)
        expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)
        expect((await adapter.getAuthStatus()).state).toBe('authenticated')

        // A later 403 on the same session is a permission denial: no new reauth.
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(authCalls(fetchMock)).toBe(1)
        expect(store.deleted).toBe(0)
      })

      it('never opens the circuit on repeated permission denials', async () => {
        const { adapter } = setup()
        const fetchMock = routed([() => Promise.resolve(jsonResponse(envelope(authPayload())))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() => expect(authCalls(fetchMock)).toBe(1))
        // Each later 403 still reaches ChilloutVR instead of failing fast as
        // "Circuit open", so valid requests are never blocked by denials.
        for (let i = 0; i < 4; i++) {
          await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        }
        expect(fetchMock.mock.calls.length - authCalls(fetchMock)).toBe(5)
      })

      it('signs out and tells the renderer when the reauth is rejected too', async () => {
        const { adapter, store, events } = setup()
        routed([() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() => expect(store.deleted).toBe(1))
        expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
        expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
      })

      it('keeps the session when the reauth cannot reach ChilloutVR', async () => {
        const { adapter, store, events } = setup()
        const fetchMock = routed([() => Promise.reject(new TypeError('offline'))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() => expect(authCalls(fetchMock)).toBe(1))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(store.deleted).toBe(0)
        expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)

        // The session's one check is spent: a later 403 does not ask again.
        // (`routed` throws "unexpected reauth" if it did.)
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(authCalls(fetchMock)).toBe(1)
      })

      it.each([
        ['a server error', () => Promise.resolve(jsonResponse({}, { status: 503 }))],
        ['a reply it cannot read', () => Promise.resolve(jsonResponse({ unexpected: true }))]
      ])('checks only once per session when the reauth gets %s', async (_label, answer) => {
        const { adapter, store } = setup()
        const fetchMock = routed([answer])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() => expect(authCalls(fetchMock)).toBe(1))
        await new Promise((resolve) => setTimeout(resolve, 0))
        for (let i = 0; i < 3; i++) {
          await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(authCalls(fetchMock)).toBe(1)
        expect(store.deleted).toBe(0)
      })

      it('adopts and persists a key the reauth rotated', async () => {
        const { adapter, store } = setup()
        routed([() => Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key-2' }))))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() =>
          expect(store.saved).toContainEqual({ username: 'trinity', accessKey: 'key-2' })
        )
        expect(store.deleted).toBe(0)
        expect((await adapter.getAuthStatus()).state).toBe('authenticated')
      })

      it('marks a same-account key rotation as identity-retained', async () => {
        const boundaries: Array<{ identityRetained: boolean }> = []
        const identities: Array<string | null> = []
        const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
        const adapter = new CvrAdapter(store, instantAdmission(), {
          socketFactory: () => ({ on: () => {}, close: () => {} }),
          onSessionBoundary: (boundary) => boundaries.push(boundary),
          onIdentity: (id) => identities.push(id)
        })
        markSessionEstablishedForTest(adapter)
        Object.assign(adapter as unknown as { accountId: string }, {
          accountId: authPayload().userId
        })
        boundaries.length = 0
        identities.length = 0
        routed([() => Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key-2' }))))])

        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        await vi.waitFor(() =>
          expect(store.saved).toContainEqual({ username: 'trinity', accessKey: 'key-2' })
        )
        expect(boundaries).toEqual([{ identityRetained: true }])
        // Never passes through "no account", which would expire saved-note revisions.
        expect(identities).not.toContain(null)
      })

      it('still signs out at once on a 401, without a reauth', async () => {
        const { adapter, store } = setup()
        const fetchMock = vi.fn(() =>
          Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))
        )
        vi.stubGlobal('fetch', fetchMock)
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
        expect(store.deleted).toBe(1)
        expect(authCalls(fetchMock)).toBe(0)
      })
    })

    it('a 5xx on getFriends does NOT emit auth-invalidated (the session is still valid)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => ({ on: () => {}, close: () => {} })
        }
      )
      markSessionEstablishedForTest(adapter)
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'oops' }, { status: 500 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)
    })
  })

  describe('live pipeline (VRX-58)', () => {
    it('withholds restored credentials from the pipeline until ACCESS_KEY validation succeeds', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload())))
      vi.stubGlobal('fetch', fetchMock)
      let dials = 0
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key-1' }),
        instantAdmission(() => new Promise<void>(() => undefined)),
        {
          socketFactory: () => {
            dials++
            return { on: () => {}, close: () => {} }
          }
        }
      )

      const unsubscribe = adapter.subscribe(() => {})
      await new Promise((resolve) => setImmediate(resolve))
      expect(dials).toBe(0)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
      await new Promise((resolve) => setImmediate(resolve))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(dials).toBe(1)
      unsubscribe()
    })

    it('subscribe starts ONE shared pipeline and stops it when the last handler leaves', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      let dials = 0
      const fakeSocket = { on: () => {}, close: () => {} }
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => {
            dials++
            return fakeSocket
          }
        }
      )
      await adapter.getAuthStatus()

      const unsubA = adapter.subscribe(() => {})
      const unsubB = adapter.subscribe(() => {})
      await new Promise((r) => setImmediate(r))

      expect(typeof unsubA).toBe('function')
      expect(dials).toBe(1) // shared — the second subscribe did not re-dial

      unsubA()
      unsubB()
      unsubB() // double-unsubscribe is safe
    })

    it('the pipeline waits (no dial) when there is no session', async () => {
      let dials = 0
      const adapter = new CvrAdapter(fakeStore(), instantAdmission(), {
        socketFactory: () => {
          dials++
          return { on: () => {}, close: () => {} }
        }
      })
      const unsub = adapter.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      expect(dials).toBe(0) // no credentials → pipelineHeaders() null → no socket
      unsub()
    })

    it('a failed CVR roster warm clears its gate so the next live edge retries', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'oops' }, { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ message: 'ok', data: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      const live: AdapterEvent = {
        type: 'connection',
        platform: 'chilloutvr',
        health: 'live'
      }

      drive.handlePipelineEvent(live)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await vi.waitFor(() =>
        expect((adapter as unknown as { rosterWarmStarted: boolean }).rosterWarmStarted).toBe(false)
      )
      drive.handlePipelineEvent(live)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })
  })
})
