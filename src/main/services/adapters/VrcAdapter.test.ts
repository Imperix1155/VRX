import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'

const noopSleep = (): Promise<void> => Promise.resolve()

/** Build a real Response so `headers.getSetCookie()` is exercised for real. */
function authResponse(
  body: unknown,
  opts: { status?: number; setCookies?: string[] } = {}
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of opts.setCookies ?? []) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers })
}

/** In-memory credential store that records every persisted value for assertions. */
function fakeStore(initial?: string): VrcCredentialStore & { saved: string[] } {
  let value = initial
  const saved: string[] = []
  return {
    load: () => value,
    save: (cookie: string) => {
      value = cookie
      saved.push(cookie)
    },
    saved
  }
}

const creds = { username: 'neo', password: 'redpill' }

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
          authResponse(
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
        .mockResolvedValue(authResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)

      await new VrcAdapter(fakeStore(), noopSleep).login({ username: 'a:b@c', password: 'p:w@d' })

      const expected = `Basic ${Buffer.from('a%3Ab%40c:p%3Aw%40d').toString('base64')}`
      expect(headerOf(lastCall(fetchMock)[1], 'Authorization')).toBe(expected)
    })

    it('never persists or transmits the password as a cookie', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(authResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()

      await new VrcAdapter(store, noopSleep).login(creds)

      expect(store.saved.some((v) => v.includes('redpill'))).toBe(false)
    })

    it('maps a 401 to a clean invalid_credentials result', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(authResponse({ error: 'x' }, { status: 401 }))
      )
      const result = await new VrcAdapter(fakeStore(), noopSleep).login(creds)
      expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    })

    it('does NOT trip the circuit breaker on repeated wrong passwords (regression)', async () => {
      // 401 via request<T> would record 3 failures → "Circuit open" lockout, even
      // with the correct password. Auth goes through rawRequest, so it must not.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(authResponse({ error: 'x' }, { status: 401 }))
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
        vi.fn().mockResolvedValue(authResponse({ unexpected: true }, { setCookies: ['auth=t'] }))
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
          authResponse(
            { requiresTwoFactorAuth: ['totp', 'otp'] },
            { setCookies: ['auth=tok1; Path=/'] }
          )
        )
        .mockResolvedValueOnce(
          authResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2; Path=/'] })
        )
        .mockResolvedValueOnce(authResponse({ id: 'usr_9', displayName: 'Trinity' }))
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

    it('routes emailOtp to /otp/verify (not /totp/verify)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          authResponse({ requiresTwoFactorAuth: ['emailOtp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          authResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        .mockResolvedValueOnce(authResponse({ id: 'u', displayName: 'X' }))
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
          authResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(authResponse({ error: 'bad code' }, { status: 400 }))
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
        authResponse({ verified: false }, { setCookies: ['twoFactorAuth=tf2'] })
      ],
      ['a malformed body', new Response('not json', { status: 200 })],
      ['a 204 with no body', new Response(null, { status: 204 })]
    ])(
      'rejects a 2xx verify with %s and does not persist a false success',
      async (_label, verifyResp) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            authResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
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
          authResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          authResponse(
            { verified: true },
            { setCookies: ['auth=rotated9; Path=/', 'twoFactorAuth=tf2'] }
          )
        )
        .mockResolvedValueOnce(authResponse({ id: 'u', displayName: 'X' }))
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
          authResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          authResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        .mockResolvedValueOnce(authResponse({ id: 'u', displayName: 'Trinity' }))
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
        .mockResolvedValue(authResponse({ id: 'usr', displayName: 'Restored' }))
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

    it('reports unauthenticated WITHOUT a network call when there is no cookie', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const status = await new VrcAdapter(fakeStore(), noopSleep).getAuthStatus()

      expect(status).toEqual({ platform: 'vrchat', state: 'unauthenticated', displayName: null })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps a 401 to unauthenticated and a network failure to error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authResponse({}, { status: 401 })))
      expect(await new VrcAdapter(fakeStore('auth=x'), noopSleep).getAuthStatus()).toMatchObject({
        state: 'unauthenticated'
      })

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(await new VrcAdapter(fakeStore('auth=x'), noopSleep).getAuthStatus()).toMatchObject({
        state: 'error'
      })
    })
  })

  describe('scaffolded methods', () => {
    it('importSession is a no-op (VRX-54)', async () => {
      const adapter = new VrcAdapter(fakeStore(), noopSleep)
      expect(await adapter.importSession()).toBe(false)
    })

    it('subscribe returns an unsubscribe function', () => {
      const adapter = new VrcAdapter(fakeStore(), noopSleep)
      expect(typeof adapter.subscribe()).toBe('function')
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
      expect(friends[0].platform).toBe('vrchat')
      expect(friends[0].platformUserId).toBe('usr_00000001')
      expect(friends[0].displayName).toBe('Alice')
    })

    it('throws (not a misleading empty list) when all friend fetches fail (VRX-43)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
      await expect(adapter.getFriends()).rejects.toThrow(/Failed to fetch friends/)
    })
  })
})
