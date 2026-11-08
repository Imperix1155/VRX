import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AdapterEvent } from '@shared/types'
import { VrcAdapter } from './VrcAdapter'
import {
  jsonResponse,
  markVrcSessionEstablished as markSessionEstablished,
  instantAdmission
} from './__testutils__/adapterTestKit'
import { FriendAlerts, type FriendAlert } from '../friendAlerts'
import { AppStatusService } from '../appStatus'
import { WorldResolver } from './vrchat/WorldResolver'
import {
  fakeStore,
  creds,
  DrivableVrcSocket,
  pipelineFrame,
  pipelineUser
} from './__testutils__/vrcAdapterTestKit'

describe('VrcAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Pipeline subscription', () => {
    it('subscribe starts ONE shared pipeline and stops it when the last handler leaves (VRX-146)', async () => {
      let dials = 0
      const fakeSocket = (): { on: () => void; close: () => void } => ({
        on: () => {},
        close: () => {}
      })
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_x'), instantAdmission(), {
        socketFactory: () => {
          dials++
          return fakeSocket()
        }
      })
      markSessionEstablished(adapter)
      // Token exchange responds OK so the pipeline dials immediately.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ token: 'authcookie_x' })))
      )

      const unsubA = adapter.subscribe(() => {})
      const unsubB = adapter.subscribe(() => {})
      await new Promise((r) => setImmediate(r))

      expect(typeof unsubA).toBe('function')
      expect(dials).toBe(1) // shared — the second subscribe did not re-dial

      unsubA()
      unsubB()
      unsubB() // double-unsubscribe is safe
    })

    it('pipeline token: prefers the GET /auth exchange, falls back to the raw cookie value (VRX-146)', async () => {
      const dialed: string[] = []
      const adapter = new VrcAdapter(
        fakeStore('auth=authcookie_raw; twoFactorAuth=tf'),
        instantAdmission(),
        {
          socketFactory: (url) => {
            dialed.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )
      markSessionEstablished(adapter)

      // Exchange succeeds → the EXCHANGED token dials the socket.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.endsWith('/auth'))
            return Promise.resolve(jsonResponse({ token: 'authcookie_exchanged' }))
          return Promise.reject(new Error('unexpected'))
        })
      )
      const unsub = adapter.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      expect(dialed[0]).toContain('authToken=authcookie_exchanged')
      unsub()

      // Exchange fails → fall back to the raw authcookie value (never the whole
      // combined cookie string).
      const dialed2: string[] = []
      const adapter2 = new VrcAdapter(
        fakeStore('auth=authcookie_raw; twoFactorAuth=tf'),
        instantAdmission(),
        {
          socketFactory: (url) => {
            dialed2.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )
      markSessionEstablished(adapter2)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('exchange down')))
      const unsub2 = adapter2.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      expect(dialed2[0]).toContain('authToken=authcookie_raw')
      expect(dialed2[0]).not.toContain('twoFactorAuth')
      unsub2()

      // A cookie VALUE containing '=' (base64 padding) must not be truncated.
      const dialed3: string[] = []
      const adapter3 = new VrcAdapter(
        fakeStore('auth=tok==pad; twoFactorAuth=tf'),
        instantAdmission(),
        {
          socketFactory: (url) => {
            dialed3.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )
      markSessionEstablished(adapter3)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('exchange down')))
      const unsub3 = adapter3.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      // Full value preserved (no '=' truncation) AND URL-encoded (reserved
      // chars can't reshape the query string — CodeRabbit).
      expect(dialed3[0]).toContain('authToken=tok%3D%3Dpad')
      unsub3()
    })

    it('pipeline token: a GET /auth 401 invalidates the session and stops dialing', async () => {
      const dialed: string[] = []
      let authStatusAnswer: Response = jsonResponse({ error: 'unauthorized' }, 401)
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ error: 'dead' }, 401))
        if (url.endsWith('/auth/user')) return Promise.resolve(authStatusAnswer)
        return Promise.reject(new Error(`unexpected: ${url}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(
        fakeStore('auth=authcookie_dead; twoFactorAuth=tf'),
        instantAdmission(),
        {
          socketFactory: (url) => {
            dialed.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )
      markSessionEstablished(adapter)
      const events: string[] = []
      const unsub = adapter.subscribe((event) =>
        events.push(event.type === 'connection' ? `connection:${event.health}` : event.type)
      )
      await vi.waitFor(() => expect(events).toContain('auth-invalidated'))
      await new Promise((r) => setImmediate(r))

      // No socket with the rejected session, no repeat exchange: the 2FA-aware
      // status check decides what happens next.
      expect(dialed).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(events).toEqual(['connection:down', 'auth-invalidated'])

      // The status check still accepts the cookie: the pipeline restarts, and a
      // repeat exchange 401 falls back to the raw cookie instead of looping.
      authStatusAnswer = jsonResponse({
        id: 'usr_aaaaaaaa-0000-0000-0000-000000000001',
        displayName: 'Self'
      })
      expect((await adapter.getAuthStatus()).state).toBe('authenticated')
      await vi.waitFor(() => expect(dialed).toHaveLength(1))
      expect(dialed[0]).toContain('authToken=authcookie_dead')
      expect(events.filter((type) => type === 'auth-invalidated')).toHaveLength(1)
      unsub()
    })

    it('reconnectNow drops the open Pipeline socket so it reconnects after a wake', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ token: 'authcookie_x' })))
      )
      const sockets: DrivableVrcSocket[] = []
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_x'), instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })
      // Nothing to drop before a session's socket exists.
      expect(() => adapter.reconnectNow()).not.toThrow()
      markSessionEstablished(adapter)
      const health: string[] = []
      const unsub = adapter.subscribe((event) => {
        if (event.type === 'connection') health.push(event.health)
      })
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      sockets[0]!.fire('open')

      adapter.reconnectNow()
      expect(sockets[0]!.closed).toBe(true)
      await vi.waitFor(() => expect(health.at(-1)).toBe('reconnecting'))
      unsub()
    })

    it('pipeline token: a GET /auth 5xx still falls back to the raw cookie', async () => {
      const dialed: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ error: 'unavailable' }, 503)))
      )
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_raw'), instantAdmission(), {
        socketFactory: (url) => {
          dialed.push(url)
          return { on: () => {}, close: () => {} }
        }
      })
      markSessionEstablished(adapter)
      const events: AdapterEvent[] = []
      const unsub = adapter.subscribe((event) => events.push(event))
      await vi.waitFor(() => expect(dialed).toHaveLength(1))
      expect(dialed[0]).toContain('authToken=authcookie_raw')
      expect(events.some((event) => event.type === 'auth-invalidated')).toBe(false)
      unsub()
    })

    it('one throwing subscriber does not starve the others in the fan-out (CodeRabbit)', async () => {
      const received: string[] = []
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_x'), instantAdmission(), {
        socketFactory: () => {
          const listeners: Record<string, (arg: unknown) => void> = {}
          const s = {
            on: (ev: string, cb: (arg: unknown) => void) => {
              listeners[ev] = cb
            },
            close: () => {}
          }
          queueMicrotask(() => listeners['open']?.(undefined))
          return s
        }
      })
      markSessionEstablished(adapter)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ token: 'authcookie_x' })))
      )

      adapter.subscribe(() => {
        throw new Error('subscriber A bug')
      })
      adapter.subscribe((e) => received.push(e.type))
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      // The 'open' → connection:'live' event must reach subscriber B despite A throwing.
      expect(received).toContain('connection')
    })

    it('pipeline token: null without a session — the pipeline never dials (VRX-146)', async () => {
      let dials = 0
      const adapter = new VrcAdapter(fakeStore(), instantAdmission(), {
        socketFactory: () => {
          dials++
          return { on: () => {}, close: () => {} }
        }
      })
      vi.stubGlobal('fetch', vi.fn())
      const unsub = adapter.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      expect(dials).toBe(0)
      unsub()
    })

    it('401 auth invalidation fences two late old-socket events out of subscribers and alert state', async () => {
      const sockets: DrivableVrcSocket[] = []
      const alerts: FriendAlert[] = []
      const engine = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Late Friend'
      })
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        },
        onSessionBoundary: () => engine.resetPlatform('vrchat')
      })
      markSessionEstablished(adapter)
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          return Promise.resolve(
            href.endsWith('/auth')
              ? jsonResponse({ token: 'account-a' })
              : jsonResponse({ error: 'expired' }, { status: 401 })
          )
        })
      )
      const unsub = adapter.subscribe((event) => {
        events.push(event)
        engine.consume(event)
      })
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      const oldSocket = sockets[0]!
      oldSocket.fire('open')
      events.length = 0

      await expect(adapter.getFriends()).rejects.toThrow()
      expect(events).toEqual([{ type: 'auth-invalidated', platform: 'vrchat' }])

      oldSocket.fire(
        'message',
        pipelineFrame('friend-active', { userId: pipelineUser.id, user: pipelineUser })
      )
      oldSocket.fire(
        'message',
        pipelineFrame('friend-online', {
          userId: pipelineUser.id,
          user: pipelineUser,
          location: 'wrld_old:1'
        })
      )

      expect(events).toEqual([{ type: 'auth-invalidated', platform: 'vrchat' }])
      expect(alerts).toEqual([])
      const state = engine as unknown as { presence: Map<string, Map<string, unknown>> }
      expect(state.presence.get('vrchat')?.size ?? 0).toBe(0)
      unsub()
    })

    it('successful 2FA bumps the generation and starts a retained subscriber after persistence', async () => {
      const sockets: DrivableVrcSocket[] = []
      let authUserCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'partial' }))
          if (href.includes('/twofactorauth/')) {
            return Promise.resolve(
              jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
            )
          }
          authUserCalls += 1
          return Promise.resolve(
            authUserCalls === 1
              ? jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=partial'] })
              : jsonResponse({ id: 'SELFUSER1', displayName: 'Neo' })
          )
        })
      )
      const alerts: FriendAlert[] = []
      const engine = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Late Friend'
      })
      const reset = vi.spyOn(engine, 'resetPlatform')
      const events: AdapterEvent[] = []
      const appStatus = new AppStatusService()
      const adapter = new VrcAdapter(fakeStore(), instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        },
        onSessionBoundary: () => engine.resetPlatform('vrchat')
      })

      expect(await adapter.login(creds)).toMatchObject({ needs2fa: true })
      const before = (adapter as unknown as { sessionGeneration: number }).sessionGeneration
      const unsub = adapter.subscribe((event) => {
        events.push(event)
        if (event.type === 'connection') {
          appStatus.recordConnection(event.platform, event.health)
        }
        engine.consume(event)
      })
      expect(sockets).toEqual([])
      expect(appStatus.snapshot().ws.vrchat).toBe('down')
      const state = engine as unknown as { presence: Map<string, Map<string, unknown>> }

      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })
      expect((adapter as unknown as { sessionGeneration: number }).sessionGeneration).toBe(
        before + 1
      )
      expect(reset).toHaveBeenCalledWith('vrchat')
      expect(state.presence.get('vrchat')?.size ?? 0).toBe(0)
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      expect(events).toEqual([{ type: 'connection', platform: 'vrchat', health: 'reconnecting' }])
      expect(appStatus.snapshot().ws.vrchat).toBe('reconnecting')

      expect(alerts).toEqual([])
      expect(state.presence.get('vrchat')?.size ?? 0).toBe(0)

      sockets[0]!.fire('open')
      expect(events).toEqual([
        { type: 'connection', platform: 'vrchat', health: 'reconnecting' },
        { type: 'connection', platform: 'vrchat', health: 'live' }
      ])
      expect(appStatus.snapshot().ws.vrchat).toBe('live')
      unsub()
    })
  })
})

describe('live pipeline world enrichment (VRX-254)', () => {
  const liveUser = {
    id: 'usr_live',
    displayName: 'Live Friend',
    currentAvatarThumbnailImageUrl: null,
    status: 'active',
    statusDescription: null,
    tags: []
  }

  function onlineFrame(worldId: string, instanceId: string): string {
    return pipelineFrame('friend-online', {
      userId: liveUser.id,
      user: liveUser,
      location: `${worldId}:${instanceId}`
    })
  }

  it('a live friend-presence for a cached world carries the cached worldName', async () => {
    const worldId = 'wrld_cached_live'
    const worldMeta = {
      name: 'Cached Live World',
      thumbnailImageUrl: 'https://example.com/cached.jpg',
      capacity: 10,
      shortName: null
    }
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/worlds/${worldId}`)) return Promise.resolve(jsonResponse(worldMeta))
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    // Pre-seed the resolver cache by resolving directly.
    const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
    await resolver.resolve(worldId)
    events.length = 0

    sockets[0]!.fire('message', onlineFrame(worldId, 'inst1'))

    const emitted = events.find((e) => e.type === 'friend-presence')
    expect(emitted).toMatchObject({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: {
        platformUserId: liveUser.id,
        instance: {
          worldId,
          instanceId: 'inst1',
          worldName: 'Cached Live World',
          thumbnailUrl: 'https://example.com/cached.jpg'
        }
      }
    })
    unsubscribe()
  })

  it('an unseen world is resolved exactly once across repeated live events, then one world-metadata emits', async () => {
    const worldId = 'wrld_unseen'
    let worldRequests = 0
    let releaseWorld!: (response: Response) => void
    const heldWorld = new Promise<Response>((resolve) => {
      releaseWorld = resolve
    })
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/worlds/${worldId}`)) {
        worldRequests += 1
        return heldWorld
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a'))
    sockets[0]!.fire('message', onlineFrame(worldId, 'b'))
    await vi.waitFor(() => expect(worldRequests).toBe(1))

    releaseWorld(
      jsonResponse({
        name: 'Unseen World',
        thumbnailImageUrl: null,
        capacity: 8,
        shortName: null
      })
    )

    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'world-metadata')).toHaveLength(1)
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worldRequests).toBe(1)
    expect(events.filter((e) => e.type === 'world-metadata')).toEqual([
      {
        type: 'world-metadata',
        platform: 'vrchat',
        worldId,
        worldName: 'Unseen World',
        thumbnailUrl: null
      }
    ])
    unsubscribe()
  })

  it('a failed resolution is not re-kicked within the negative-cache window', async () => {
    const worldId = 'wrld_fail'
    let worldRequests = 0
    let now = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/worlds/${worldId}`)) {
        worldRequests += 1
        return Promise.reject(new Error('world offline'))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    // Inject a clock so we can advance the negative TTL deterministically.
    const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
    const originalClock = (resolver as unknown as { clock: () => number }).clock
    vi.spyOn(resolver as unknown as { clock: () => number }, 'clock').mockImplementation(() => {
      void originalClock
      return now
    })

    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a'))
    await vi.waitFor(() => expect(worldRequests).toBe(1))

    // Still inside the negative window: another event must not re-kick.
    sockets[0]!.fire('message', onlineFrame(worldId, 'b'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worldRequests).toBe(1)

    // Advance past the negative TTL: the next event may retry.
    now = 61_000
    sockets[0]!.fire('message', onlineFrame(worldId, 'c'))
    await vi.waitFor(() => expect(worldRequests).toBe(2))

    expect(events.filter((e) => e.type === 'world-metadata')).toHaveLength(0)
    unsubscribe()
  })

  it('a resolution landing with a stale sessionGeneration emits nothing', async () => {
    const worldId = 'wrld_stalegen'
    let releaseWorld!: (response: Response) => void
    const heldWorld = new Promise<Response>((resolve) => {
      releaseWorld = resolve
    })
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      const headers = (options?.headers ?? {}) as Record<string, string>
      if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (href.includes(`/worlds/${worldId}`)) return heldWorld
      if (headers.Authorization !== undefined) {
        return Promise.resolve(
          jsonResponse({ id: 'NEW', displayName: 'New' }, { setCookies: ['auth=new'] })
        )
      }
      return Promise.reject(new Error(`unexpected: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=old'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a'))
    await vi.waitFor(() => expect(sockets[0]!.closed).toBe(false))

    // Bump the session generation before the held resolution lands.
    await adapter.login({ username: 'new', password: 'pw' })
    events.length = 0

    releaseWorld(
      jsonResponse({ name: 'Stale World', thumbnailImageUrl: null, capacity: 8, shortName: null })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.filter((e) => e.type === 'world-metadata')).toHaveLength(0)
    unsubscribe()
  })

  it('does not let an old live world completion erase the replacement generation pending marker', async () => {
    const worldId = 'wrld_live_pending_owner'
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
      enrichPipelineEvent(event: AdapterEvent, generation: number): AdapterEvent
    }
    const event = {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: { instance: { worldId } }
    } as AdapterEvent

    internal.enrichPipelineEvent(event, internal.sessionGeneration)
    await vi.waitFor(() => expect(worldRequestCookies).toEqual(['auth=account-a']))
    await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
      ok: true
    })
    internal.enrichPipelineEvent(event, internal.sessionGeneration)
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

  it('unconditionally sweeps pendingWorldResolutions after a live-event 401 so the world refetches after re-login', async () => {
    const worldId = 'wrld_unconditional'
    let worldFetches = 0
    const pendingWorlds: Array<(response: Response) => void> = []
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      const href =
        typeof url === 'string' ? url : url instanceof URL ? url.href : (url as { url: string }).url
      const headers = (options?.headers ?? {}) as Record<string, string>
      if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (href.includes(`/worlds/${worldId}`)) {
        worldFetches += 1
        return new Promise<Response>((resolve) => {
          pendingWorlds.push(resolve)
        })
      }
      if (href.endsWith('/auth/user') && headers.Authorization !== undefined) {
        return Promise.resolve(
          jsonResponse({ id: 'NEW', displayName: 'New' }, { setCookies: ['auth=new'] })
        )
      }
      return Promise.reject(new Error(`unexpected: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=old'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a'))
    await vi.waitFor(() => expect(worldFetches).toBe(1))

    // A 401 on the held fetch forces a session boundary.
    pendingWorlds.shift()!(jsonResponse({ error: 'unauthorized' }, { status: 401 }))
    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The .finally must have swept the id unconditionally — this is the F1 fix.
    const pending = (adapter as unknown as { pendingWorldResolutions: Set<string> })
      .pendingWorldResolutions
    expect(pending.has(worldId)).toBe(false)

    // Re-login: bumpSessionGeneration creates a new pipeline because the handler
    // is still subscribed, so the same world can be re-fetched on the next event.
    await adapter.login({ username: 'new', password: 'pw' })
    await vi.waitFor(() => expect(sockets).toHaveLength(3))
    const newSocket = sockets[2]!
    expect(newSocket.closed).toBe(false)
    newSocket.fire('open')

    events.length = 0
    newSocket.fire('message', onlineFrame(worldId, 'b'))
    await vi.waitFor(() => expect(worldFetches).toBe(2))

    pendingWorlds.shift()!(
      jsonResponse({
        name: 'Re-fetched World',
        thumbnailImageUrl: null,
        capacity: 8,
        shortName: null
      })
    )
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'world-metadata',
          platform: 'vrchat',
          worldId,
          worldName: 'Re-fetched World'
        })
      )
    )
    unsubscribe()
  })

  it('a live move to a cached world resolves the name without a refetch (manual-reconcile severity)', async () => {
    const worldId = 'wrld_manual'
    const worldMeta = {
      name: 'Manual Reconcile World',
      thumbnailImageUrl: 'https://example.com/manual.jpg',
      capacity: 10,
      shortName: null
    }
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/worlds/${worldId}`)) return Promise.resolve(jsonResponse(worldMeta))
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
    await resolver.resolve(worldId)
    fetchMock.mockClear()
    events.length = 0

    sockets[0]!.fire('message', onlineFrame(worldId, 'inst1'))

    const emitted = events.find((e) => e.type === 'friend-presence')
    expect(emitted).toMatchObject({
      type: 'friend-presence',
      friend: {
        instance: {
          worldId,
          worldName: 'Manual Reconcile World',
          thumbnailUrl: 'https://example.com/manual.jpg'
        }
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('a 403 on a live-event world fetch is negative-cached, so the next event does not re-fetch', async () => {
    const worldId = 'wrld_403live'
    let worldRequests = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/worlds/${worldId}`)) {
        worldRequests += 1
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    markSessionEstablished(adapter)
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a'))
    await vi.waitFor(() => expect(worldRequests).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // A 403 denies this one world on a live session, so it is negative-cached
    // like a deleted world and the next event does not re-request it.
    const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
    expect(resolver.peek(worldId)).toBeNull()

    sockets[0]!.fire('message', onlineFrame(worldId, 'b'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worldRequests).toBe(1)

    unsubscribe()
  })

  it('three live-event 403 failures open the shared circuit for unrelated adapter calls', async () => {
    const worldIds = ['wrld_403a', 'wrld_403b', 'wrld_403c']
    let worldRequests = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes('/worlds/')) {
        worldRequests += 1
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
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
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    for (let i = 0; i < worldIds.length; i++) {
      sockets[0]!.fire('message', onlineFrame(worldIds[i]!, `inst${i}`))
    }
    await vi.waitFor(() => expect(worldRequests).toBe(3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(adapter.selfInvite('wrld_circuit:12345~private(usr_self)')).rejects.toThrow(
      /Circuit open/
    )
    unsubscribe()
  })

  it('missing, failing or unreadable live-event worlds do not open the shared circuit', async () => {
    const answers: Record<string, () => Response> = {
      wrld_missing: () => jsonResponse({ error: 'not found' }, 404),
      wrld_failing: () => jsonResponse({ error: 'server' }, 503),
      wrld_unreadable: () => new Response('not json', { status: 200 })
    }
    let worldRequests = 0
    let inviteRequests = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      const worldId = /\/worlds\/([^/?]+)/.exec(url)?.[1]
      if (worldId !== undefined && answers[worldId]) {
        worldRequests += 1
        return Promise.resolve(answers[worldId]())
      }
      if (url.includes('/invite/myself/to/')) {
        inviteRequests += 1
        return Promise.resolve(jsonResponse({ type: 'invite' }))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
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
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    Object.keys(answers).forEach((worldId, i) => {
      sockets[0]!.fire('message', onlineFrame(worldId, `inst${i}`))
    })
    await vi.waitFor(() => expect(worldRequests).toBe(3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Each answer is cached as "no metadata" for that world only.
    const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
    for (const worldId of Object.keys(answers)) expect(resolver.peek(worldId)).toBeNull()
    await expect(
      adapter.selfInvite('wrld_circuit:12345~private(usr_self)')
    ).resolves.toBeUndefined()
    expect(inviteRequests).toBe(1)
    unsubscribe()
  })

  it('three missing roster worlds leave auth status and the next roster working', async () => {
    const worldId = (n: number): string => `wrld_00000000-0000-0000-0000-00000000000${n}`
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/user/friends')) {
        const firstOnlinePage = !url.includes('offline=true') && url.includes('offset=0')
        return Promise.resolve(
          jsonResponse(
            firstOnlinePage
              ? [1, 2, 3].map((n) => ({
                  id: `usr_${n}`,
                  displayName: `Friend ${n}`,
                  status: 'active',
                  tags: [],
                  location: `${worldId(n)}:1234~private(usr_x)`
                }))
              : []
          )
        )
      }
      if (url.includes('/worlds/')) return Promise.resolve(jsonResponse({ error: 'gone' }, 404))
      return Promise.resolve(
        jsonResponse({
          id: 'usr_aaaaaaaa-0000-0000-0000-000000000001',
          displayName: 'Self',
          onlineFriends: ['usr_1', 'usr_2', 'usr_3'],
          activeFriends: [],
          offlineFriends: []
        })
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission(), {
      socketFactory: () => ({ on: () => {}, close: () => {} })
    })
    expect((await adapter.getAuthStatus()).state).toBe('authenticated')
    expect((await adapter.getFriends()).friends).toHaveLength(3)
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('/worlds/'))).toHaveLength(3)
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((await adapter.getAuthStatus()).state).toBe('authenticated')
    expect((await adapter.getFriends()).friends).toHaveLength(3)
  })
})
