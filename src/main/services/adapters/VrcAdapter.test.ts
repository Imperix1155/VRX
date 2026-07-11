import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'
import { FriendAlerts, type FriendAlert } from '../friendAlerts'

/** In-memory credential store that records persisted values + delete calls for assertions. */
function fakeStore(initial?: string): VrcCredentialStore & { saved: string[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as string[],
    deleted: 0,
    load: () => value,
    save: (cookie: string) => {
      value = cookie
      store.saved.push(cookie)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

const creds = { username: 'neo', password: 'redpill' }

type SocketListener = (...args: unknown[]) => void
class DrivableVrcSocket {
  private readonly listeners = new Map<string, SocketListener[]>()
  closed = false

  on(event: string, listener: SocketListener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.fire('close')
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

const pipelineFrame = (type: string, content: unknown): string =>
  JSON.stringify({ type, content: JSON.stringify(content) })

const pipelineUser = {
  id: 'usr_late',
  displayName: 'Late Friend',
  currentAvatarThumbnailImageUrl: null,
  status: 'active',
  statusDescription: null,
  tags: []
}

function lastCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit]
}
function headerOf(options: RequestInit, name: string): string | undefined {
  return (options.headers as Record<string, string>)[name]
}

describe('VrcAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('login (no 2FA)', () => {
    it('authenticates, persists ONLY the auth cookie (attributes stripped), reports the display name', async () => {
      // A Response body is single-use, and this test fetches twice (login +
      // getAuthStatus) — return a fresh Response per call.
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { id: 'usr_1', displayName: 'Neo' },
            { setCookies: ['auth=abc123; Path=/; HttpOnly; Secure'] }
          )
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, noopSleep)

      const result = await adapter.login(creds)

      expect(result).toEqual({ ok: true })
      expect(store.saved).toEqual(['auth=abc123']) // attributes stripped, password never stored
      const status = await adapter.getAuthStatus()
      expect(status).toEqual({ platform: 'vrchat', state: 'authenticated', displayName: 'Neo' })
    })

    it('sends Basic auth with url-encoded username:password', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)

      await new VrcAdapter(fakeStore(), noopSleep).login({ username: 'a:b@c', password: 'p:w@d' })

      const expected = `Basic ${Buffer.from('a%3Ab%40c:p%3Aw%40d').toString('base64')}`
      expect(headerOf(lastCall(fetchMock)[1], 'Authorization')).toBe(expected)
    })

    it('never persists or transmits the password as a cookie', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()

      await new VrcAdapter(store, noopSleep).login(creds)

      expect(store.saved.some((v) => v.includes('redpill'))).toBe(false)
    })

    it('maps a 401 to a clean invalid_credentials result', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )
      const result = await new VrcAdapter(fakeStore(), noopSleep).login(creds)
      expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    })

    it('does NOT trip the circuit breaker on repeated wrong passwords (regression)', async () => {
      // 401 via request<T> would record 3 failures → "Circuit open" lockout, even
      // with the correct password. Auth goes through rawRequest, so it must not.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )
      const adapter = new VrcAdapter(fakeStore(), noopSleep)

      for (let i = 0; i < 5; i++) {
        expect(await adapter.login(creds)).toEqual({
          ok: false,
          needs2fa: false,
          error: 'invalid_credentials'
        })
      }
    })

    it('flags an unexpected response body as an error rather than a false success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ unexpected: true }, { setCookies: ['auth=t'] }))
      )
      const result = await new VrcAdapter(fakeStore(), noopSleep).login(creds)
      expect(result).toEqual({ ok: false, needs2fa: false, error: 'unexpected_response' })
    })
  })

  describe('2FA', () => {
    it('returns needs2fa(totp), then verifies against /totp/verify and combines the cookies', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { requiresTwoFactorAuth: ['totp', 'otp'] },
            { setCookies: ['auth=tok1; Path=/'] }
          )
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2; Path=/'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'usr_9', displayName: 'Trinity' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, noopSleep)

      const first = await adapter.login(creds)
      expect(first).toEqual({ ok: false, needs2fa: true, method: 'totp' })

      const second = await adapter.login({ ...creds, twoFactorCode: '123456' })
      expect(second).toEqual({ ok: true })

      const [verifyUrl, verifyOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(verifyUrl).toMatch(/\/auth\/twofactorauth\/totp\/verify$/)
      expect(verifyOpts.method).toBe('POST')
      expect(headerOf(verifyOpts, 'Cookie')).toBe('auth=tok1')
      expect(verifyOpts.body).toBe(JSON.stringify({ code: '123456' }))
      expect(store.saved.at(-1)).toBe('auth=tok1; twoFactorAuth=tf2')
    })

    it('fences the old account on first-leg cookie replacement and clears its cached display name', async () => {
      const sockets: DrivableVrcSocket[] = []
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (href.endsWith('/auth')) {
          return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
        }
        if (href.includes('/twofactorauth/')) {
          return Promise.resolve(
            jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=account-b-2fa'] })
          )
        }
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-b'] })
          )
        }
        if (headers.Cookie === 'auth=account-a') {
          return Promise.resolve(jsonResponse({ id: 'usr_a', displayName: 'Account A' }))
        }
        return Promise.resolve(jsonResponse({ error: 'refresh failed' }, { status: 500 }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const alerts: FriendAlert[] = []
      const engine = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Account A Friend'
      })
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), noopSleep, {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        },
        onSessionBoundary: () => engine.resetPlatform('vrchat')
      })

      expect(await adapter.getAuthStatus()).toMatchObject({ displayName: 'Account A' })
      const unsubscribe = adapter.subscribe((event) => {
        events.push(event)
        engine.consume(event)
      })
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      const oldSocket = sockets[0]!
      oldSocket.fire('open')
      events.length = 0
      const generationBeforeLogin = (adapter as unknown as { sessionGeneration: number })
        .sessionGeneration

      expect(await adapter.login({ username: 'account-b', password: 'pw' })).toEqual({
        ok: false,
        needs2fa: true,
        method: 'totp'
      })
      expect((adapter as unknown as { sessionGeneration: number }).sessionGeneration).toBe(
        generationBeforeLogin + 1
      )
      expect(oldSocket.closed).toBe(true)

      oldSocket.fire(
        'message',
        pipelineFrame('friend-active', { userId: pipelineUser.id, user: pipelineUser })
      )
      oldSocket.fire(
        'message',
        pipelineFrame('friend-online', {
          userId: pipelineUser.id,
          user: pipelineUser,
          location: 'wrld_account_a:1'
        })
      )
      expect(events).toEqual([])
      expect(alerts).toEqual([])

      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })
      expect((adapter as unknown as { displayName: string | null }).displayName).toBeNull()
      unsubscribe()
    })

    it('routes emailOtp to /otp/verify (not /totp/verify)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['emailOtp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'u', displayName: 'X' }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), noopSleep)

      expect(await adapter.login(creds)).toEqual({ ok: false, needs2fa: true, method: 'email' })
      await adapter.login({ ...creds, twoFactorCode: '000000' })

      expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toMatch(
        /\/auth\/twofactorauth\/otp\/verify$/
      )
    })

    it('reports a rejected 2FA code', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'bad code' }, { status: 400 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), noopSleep)

      await adapter.login(creds)
      expect(await adapter.login({ ...creds, twoFactorCode: 'wrong' })).toEqual({
        ok: false,
        needs2fa: false,
        error: 'invalid_2fa_code'
      })
    })

    it.each([
      [
        '{ verified: false }',
        jsonResponse({ verified: false }, { setCookies: ['twoFactorAuth=tf2'] })
      ],
      ['a malformed body', new Response('not json', { status: 200 })],
      ['a 204 with no body', new Response(null, { status: 204 })]
    ])(
      'rejects a 2xx verify with %s and does not persist a false success',
      async (_label, verifyResp) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
          )
          .mockResolvedValueOnce(verifyResp)
        vi.stubGlobal('fetch', fetchMock)
        const store = fakeStore()
        const adapter = new VrcAdapter(store, noopSleep)

        await adapter.login(creds)
        const result = await adapter.login({ ...creds, twoFactorCode: '123456' })

        expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_2fa_code' })
        expect(store.saved).toEqual([]) // nothing persisted — login did not falsely succeed
      }
    )

    it('adopts a rotated auth token if the verify response re-issues one', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse(
            { verified: true },
            { setCookies: ['auth=rotated9; Path=/', 'twoFactorAuth=tf2'] }
          )
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'u', displayName: 'X' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, noopSleep)

      await adapter.login(creds)
      await adapter.login({ ...creds, twoFactorCode: '123456' })

      expect(store.saved.at(-1)).toBe('auth=rotated9; twoFactorAuth=tf2')
    })

    it('verify2fa completes the second leg via the session cookie, no credentials resent (VRX-159)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'u', displayName: 'Trinity' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, noopSleep)

      expect(await adapter.login(creds)).toEqual({ ok: false, needs2fa: true, method: 'totp' })
      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })

      const [verifyUrl, verifyOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(verifyUrl).toMatch(/\/auth\/twofactorauth\/totp\/verify$/)
      expect(verifyOpts.body).toBe(JSON.stringify({ code: '123456' }))
      expect(store.saved.at(-1)).toBe('auth=tok1; twoFactorAuth=tf2')
    })
  })

  describe('getAuthStatus & session restore', () => {
    it('restores a persisted cookie and sends it on the status check', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'usr', displayName: 'Restored' }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=restored'), noopSleep)

      const status = await adapter.getAuthStatus()

      expect(status).toEqual({
        platform: 'vrchat',
        state: 'authenticated',
        displayName: 'Restored'
      })
      expect(headerOf(lastCall(fetchMock)[1], 'Cookie')).toBe('auth=restored')
    })

    it.each([
      ['200 from the old account', 200],
      ['401 from the old account', 401]
    ])('fences a held %s across logout and relogin', async (_label, staleStatus) => {
      let releaseOldStatus!: (response: Response) => void
      const heldOldStatus = new Promise<Response>((resolve) => {
        releaseOldStatus = resolve
      })
      let oldStatusStarted = false
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) {
          return Promise.resolve(
            jsonResponse(
              { id: 'usr_new', displayName: 'New Account' },
              { setCookies: ['auth=new-account'] }
            )
          )
        }
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=old-account') {
          oldStatusStarted = true
          return heldOldStatus
        }
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=new-account') {
          return Promise.resolve(jsonResponse({ id: 'usr_new', displayName: 'New Account' }))
        }
        return Promise.reject(new Error('unexpected request'))
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore('auth=old-account')
      const adapter = new VrcAdapter(store, noopSleep)

      const status = adapter.getAuthStatus()
      await vi.waitFor(() => expect(oldStatusStarted).toBe(true))
      adapter.clearSession()
      expect(await adapter.login({ username: 'new-account', password: 'pw' })).toEqual({ ok: true })

      releaseOldStatus(
        staleStatus === 401
          ? jsonResponse({ error: 'old session expired' }, { status: 401 })
          : jsonResponse({ id: 'usr_old', displayName: 'Old Account' })
      )

      await expect(status).resolves.toEqual({
        platform: 'vrchat',
        state: 'authenticated',
        displayName: 'New Account'
      })
      const statusCookies = fetchMock.mock.calls
        .map((call) => call as [RequestInfo | URL, RequestInit | undefined])
        .filter(([, options]) => {
          const headers = (options?.headers ?? {}) as Record<string, string>
          return headers.Authorization === undefined && headers.Cookie !== undefined
        })
        .map(([, options]) => ((options?.headers ?? {}) as Record<string, string>).Cookie)
      expect(statusCookies).toEqual(['auth=old-account', 'auth=new-account'])
      // Only the deliberate logout deleted credentials; the stale 401 did not
      // delete or otherwise invalidate the replacement session.
      expect(store.deleted).toBe(1)
    })

    it('reports unauthenticated WITHOUT a network call when there is no cookie', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const status = await new VrcAdapter(fakeStore(), noopSleep).getAuthStatus()

      expect(status).toEqual({ platform: 'vrchat', state: 'unauthenticated', displayName: null })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps a 401 to unauthenticated and a network failure to error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 })))
      expect(await new VrcAdapter(fakeStore('auth=x'), noopSleep).getAuthStatus()).toMatchObject({
        state: 'unauthenticated'
      })

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(await new VrcAdapter(fakeStore('auth=x'), noopSleep).getAuthStatus()).toMatchObject({
        state: 'error'
      })
    })

    it('repeated network validation failures do not block a subsequent correct login', async () => {
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

      for (let i = 0; i < 3; i++) {
        expect((await adapter.getAuthStatus()).state).toBe('error')
      }

      const loginFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'usr', displayName: 'Neo' }))
      vi.stubGlobal('fetch', loginFetch)

      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect(loginFetch).toHaveBeenCalledTimes(1)
    })

    it('login punches through an OPEN circuit breaker tripped by DATA calls (VRX-190 parity)', async () => {
      // Trip the shared breaker via the guarded data path (getFriends), then
      // prove a deliberate login still reaches the wire — resetCircuit() runs
      // first, mirroring CvrAdapter.login (parity gap caught on VRX-189).
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      }

      const loginFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'usr', displayName: 'Neo' }))
      vi.stubGlobal('fetch', loginFetch)
      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect(loginFetch).toHaveBeenCalled()
    })

    it('maps an unparseable 200 body to unauthenticated WITHOUT clearing the session', async () => {
      // The body is garbage but the server said 200 — the cookie may be fine
      // (transient drift); nuking the persisted session here would force a full
      // re-login over a blip.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ totally: 'wrong' })))
      const store = fakeStore('auth=x')

      expect(await new VrcAdapter(store, noopSleep).getAuthStatus()).toMatchObject({
        state: 'unauthenticated'
      })
      expect(store.deleted).toBe(0)
    })

    it('reports needs-2fa (method totp) when only the second factor expired — session KEPT (VRX-173)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ requiresTwoFactorAuth: ['totp', 'otp'] }))
      )
      const store = fakeStore('auth=tok1; twoFactorAuth=stale')
      const adapter = new VrcAdapter(store, noopSleep)

      const status = await adapter.getAuthStatus()

      expect(status).toEqual({
        platform: 'vrchat',
        state: 'needs-2fa',
        displayName: null,
        twoFactorMethod: 'totp'
      })
      // The auth cookie is ALIVE — recoverable with just a code. Never clear.
      expect(store.deleted).toBe(0)
    })

    it('completes the 2FA reprompt loop: needs-2fa → verify2fa → authenticated (VRX-173)', async () => {
      const fetchMock = vi
        .fn()
        // getAuthStatus: auth cookie alive, second factor expired (email method)
        .mockResolvedValueOnce(jsonResponse({ requiresTwoFactorAuth: ['emailOtp'] }))
        // verify: fresh twoFactorAuth issued; auth NOT re-issued
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh; Path=/'] })
        )
        // refreshDisplayName + follow-up status check — a Response body is
        // single-use, so build a FRESH one per call.
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ id: 'usr_9', displayName: 'Trinity' }))
        )
      vi.stubGlobal('fetch', fetchMock)
      // Restored session cookie is the COMBINED string from the last full login.
      const store = fakeStore('auth=tok1; twoFactorAuth=stale')
      const adapter = new VrcAdapter(store, noopSleep)

      expect(await adapter.getAuthStatus()).toMatchObject({
        state: 'needs-2fa',
        twoFactorMethod: 'email'
      })

      // The reprompt method came from getAuthStatus (login() never ran) — the
      // verify must route to /otp/verify, not the totp default.
      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })
      expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toMatch(
        /\/auth\/twofactorauth\/otp\/verify$/
      )

      // The rebuilt cookie keeps the auth PART and the fresh twoFactorAuth —
      // never the stale one, never duplicates (the cookiePart fix): a whole-
      // string fallback would have persisted "…; twoFactorAuth=stale; …=fresh"
      // with the stale part winning server-side → endless reprompt loop.
      expect(store.saved.at(-1)).toBe('auth=tok1; twoFactorAuth=fresh')

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'authenticated' })
    })

    it('clears a dead session on 401 — memory, request mirror, AND persisted blob', async () => {
      // First status check: the persisted cookie is rejected (session expired).
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore('auth=expired')
      const adapter = new VrcAdapter(store, noopSleep)

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      // The dead cookie was wiped from disk so session restore can't re-adopt it.
      expect(store.deleted).toBe(1)
      expect(store.load()).toBeUndefined()

      // Proof the in-memory cookie + VrcApiClient mirror are gone: the next
      // status check short-circuits to unauthenticated with NO network call.
      fetchMock.mockClear()
      expect(await adapter.getAuthStatus()).toEqual({
        platform: 'vrchat',
        state: 'unauthenticated',
        displayName: null
      })
      expect(fetchMock).not.toHaveBeenCalled()

      // Proof the persisted blob is gone too — a FRESH adapter (the next launch)
      // built on the same store finds nothing to restore and never hits the wire.
      const relaunched = new VrcAdapter(store, noopSleep)
      expect(await relaunched.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps automatic 401 deletion best-effort when the credential store is unavailable', async () => {
      const store: VrcCredentialStore = {
        load: () => 'auth=expired',
        save: () => {},
        delete: () => {
          throw new Error('safeStorage unavailable')
        }
      }
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(store, noopSleep)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      fetchMock.mockClear()
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('propagates explicit logout deletion failure without clearing the live session', async () => {
      const store: VrcCredentialStore = {
        load: () => 'auth=current',
        save: () => {},
        delete: () => {
          throw new Error('credential deletion failed')
        }
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ id: 'usr_current', displayName: 'Current' }))
      )
      const adapter = new VrcAdapter(store, noopSleep)

      expect(() => adapter.clearSession()).toThrow('credential deletion failed')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        displayName: 'Current'
      })
    })
  })

  describe('scaffolded methods', () => {
    it('importSession is a no-op (VRX-54)', async () => {
      const adapter = new VrcAdapter(fakeStore(), noopSleep)
      expect(await adapter.importSession()).toBe(false)
    })

    it('subscribe starts ONE shared pipeline and stops it when the last handler leaves (VRX-146)', async () => {
      let dials = 0
      const fakeSocket = (): { on: () => void; close: () => void } => ({
        on: () => {},
        close: () => {}
      })
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_x'), noopSleep, {
        socketFactory: () => {
          dials++
          return fakeSocket()
        }
      })
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
        noopSleep,
        {
          socketFactory: (url) => {
            dialed.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )

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
        noopSleep,
        {
          socketFactory: (url) => {
            dialed2.push(url)
            return { on: () => {}, close: () => {} }
          }
        }
      )
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('exchange down')))
      const unsub2 = adapter2.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      expect(dialed2[0]).toContain('authToken=authcookie_raw')
      expect(dialed2[0]).not.toContain('twoFactorAuth')
      unsub2()

      // A cookie VALUE containing '=' (base64 padding) must not be truncated.
      const dialed3: string[] = []
      const adapter3 = new VrcAdapter(fakeStore('auth=tok==pad; twoFactorAuth=tf'), noopSleep, {
        socketFactory: (url) => {
          dialed3.push(url)
          return { on: () => {}, close: () => {} }
        }
      })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('exchange down')))
      const unsub3 = adapter3.subscribe(() => {})
      await new Promise((r) => setImmediate(r))
      // Full value preserved (no '=' truncation) AND URL-encoded (reserved
      // chars can't reshape the query string — CodeRabbit).
      expect(dialed3[0]).toContain('authToken=tok%3D%3Dpad')
      unsub3()
    })

    it('one throwing subscriber does not starve the others in the fan-out (CodeRabbit)', async () => {
      const received: string[] = []
      const adapter = new VrcAdapter(fakeStore('auth=authcookie_x'), noopSleep, {
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
      const adapter = new VrcAdapter(fakeStore(), noopSleep, {
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
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), noopSleep, {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        },
        onSessionBoundary: () => engine.resetPlatform('vrchat')
      })
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

    it('successful 2FA bumps the session generation, resets alerts, and drops old-pipeline events', async () => {
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
              : jsonResponse({ id: 'usr_self', displayName: 'Neo' })
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
      const adapter = new VrcAdapter(fakeStore(), noopSleep, {
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
        engine.consume(event)
      })
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      const oldSocket = sockets[0]!
      oldSocket.fire('open')
      oldSocket.fire(
        'message',
        pipelineFrame('friend-active', { userId: pipelineUser.id, user: pipelineUser })
      )
      const state = engine as unknown as { presence: Map<string, Map<string, unknown>> }
      expect(state.presence.get('vrchat')?.size).toBe(1)
      events.length = 0

      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })
      expect((adapter as unknown as { sessionGeneration: number }).sessionGeneration).toBe(
        before + 1
      )
      expect(reset).toHaveBeenCalledWith('vrchat')
      expect(state.presence.get('vrchat')?.size ?? 0).toBe(0)

      oldSocket.fire(
        'message',
        pipelineFrame('friend-online', {
          userId: pipelineUser.id,
          user: pipelineUser,
          location: 'wrld_old:2'
        })
      )
      expect(events).toEqual([])
      expect(alerts).toEqual([])
      expect(state.presence.get('vrchat')?.size ?? 0).toBe(0)
      unsub()
    })

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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

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

      const friends = await adapter.getFriends()
      expect(friends).toHaveLength(1)
      expect(friends[0]!.platform).toBe('vrchat')
      expect(friends[0]!.platformUserId).toBe('usr_00000001')
      expect(friends[0]!.displayName).toBe('Alice')
    })

    it('retries a stale account-A roster error and returns account B without invalidating it', async () => {
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
              { id: 'usr_account_b', displayName: 'Account B' },
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
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), noopSleep, {
        onSessionBoundary: boundary
      })

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(accountAStarted).toBe(true))
      expect(await adapter.login({ username: 'account-b', password: 'pw' })).toEqual({ ok: true })
      const boundariesAfterLogin = boundary.mock.calls.length
      releaseAccountA(jsonResponse({ error: 'expired account A' }, { status: 401 }))

      await expect(roster).resolves.toEqual([
        expect.objectContaining({ platformUserId: 'usr_b_friend', displayName: 'Account B Friend' })
      ])
      expect(boundary).toHaveBeenCalledTimes(boundariesAfterLogin)
    })

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
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
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
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
    })

    it('a 401 on the buckets probe EMITS auth-invalidated so the renderer re-checks auth (VRX-195/197)', async () => {
      // VRChat parity with CVR: a data-path 401 (dead cookie / expired 2FA) must
      // surface as auth-invalidated so the renderer quarantines + re-checks auth,
      // not silently degrade to an empty roster. The buckets probe is /auth/user.
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
    })

    it('a 5xx on the buckets probe does NOT emit auth-invalidated (session still valid)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'oops' }, { status: 500 }))
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      const friends = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.displayName).toBe('Alice')

      // The circuit must NOT have recorded the drifted record as a failure: a
      // follow-up call still reaches the wire (an open circuit would throw
      // 'Circuit open' before fetching).
      await expect(adapter.getFriends()).resolves.toHaveLength(1)
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
    })

    it('enriches friends in worlds with worldName/thumbnailUrl (VRX-163)', async () => {
      const worldId = 'wrld_abc123'
      const worldMeta = {
        name: 'The Grid',
        thumbnailImageUrl: 'https://example.com/thumb.jpg',
        capacity: 20,
        shortName: null
      }
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
          return Promise.resolve(
            new Response(JSON.stringify(worldMeta), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          )
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      const friends = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.instance?.worldName).toBe('The Grid')
      expect(friends[0]!.instance?.thumbnailUrl).toBe('https://example.com/thumb.jpg')
    })

    it('a 401 during WORLD enrichment (session dies mid-fetch) EMITS auth-invalidated (VRX-197, Codex)', async () => {
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      adapter.subscribe((e) => events.push(e))

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      const friends = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.instance).toBeNull()
    })

    it('keeps worldName null for an unresolvable world, friends still returned (VRX-163)', async () => {
      const worldId = 'wrld_deleted999'
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
          // Returns a body that fails WorldApiSchema → resolver returns null
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          )
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      const friends = await adapter.getFriends()

      expect(friends).toHaveLength(1)
      expect(friends[0]!.instance?.worldName).toBeNull()
      expect(friends[0]!.instance?.worldId).toBe(worldId)
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
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)

      await adapter.getFriends()
      await adapter.getFriends()

      // The world was fetched only once because the resolver's TTL cache persists
      // across getFriends calls (single worldResolver field, not recreated per call).
      expect(worldFetchCount.n).toBe(1)
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
      const adapter = new VrcAdapter(fakeStore('auth=tok'), noopSleep)

      await adapter.selfInvite(inviteLocation)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.vrchat.cloud/api/1/invite/myself/to/${inviteLocation}`)
      expect(opts.method).toBe('POST')
    })

    it('rejects without an API call for public instances', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), noopSleep)

      await expect(adapter.selfInvite(publicLocation)).rejects.toThrow(
        /no invite needed for public instances/i
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects with a generic error when the API call fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), noopSleep)

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
      'not-a-location' // missing wrld_ prefix
    ])('rejects unsafe/malformed location %j with NO API call (VRX-51 security)', async (bad) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=tok'), noopSleep)

      await expect(adapter.selfInvite(bad)).rejects.toThrow(/invalid instance location/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
