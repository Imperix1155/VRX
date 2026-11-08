import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import { CvrAdapter } from './CvrAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { jsonResponse, instantAdmission, ownerBindingHarness } from './__testutils__/adapterTestKit'
import { fakeStore, authPayload, envelope, creds } from './__testutils__/cvrAdapterTestKit'

describe('CvrAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('login (password leg — raw, breaker-free)', () => {
    it('binds the owner on first login into an empty credential slot', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const binding = ownerBindingHarness<CVRCredentials>()
      const adapter = new CvrAdapter(binding.store, instantAdmission())

      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    })

    it('rebinds an A-to-B replacement to B after the new credential is persisted', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(envelope(authPayload())))
        .mockResolvedValueOnce(
          jsonResponse(
            envelope(
              authPayload({
                username: 'morpheus',
                accessKey: 'key-2',
                userId: 'a1b2c3d4-0000-0000-0000-000000000002'
              })
            )
          )
        )
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<CVRCredentials>()
      const adapter = new CvrAdapter(binding.store, instantAdmission())

      await adapter.login(creds)
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000002')
    })

    it('keeps the last-started direct login when an older response lands later', async () => {
      let releaseAccountA!: (response: Response) => void
      let accountAStarted = false
      const heldAccountA = new Promise<Response>((resolve) => {
        releaseAccountA = resolve
      })
      let loginCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          loginCalls += 1
          if (loginCalls === 1) {
            accountAStarted = true
            return heldAccountA
          }
          return Promise.resolve(
            jsonResponse(
              envelope(
                authPayload({
                  username: 'morpheus',
                  accessKey: 'key-b',
                  userId: 'a1b2c3d4-0000-0000-0000-000000000002'
                })
              )
            )
          )
        })
      )
      const binding = ownerBindingHarness<CVRCredentials>()
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const accountALogin = adapter.login({ username: 'trinity@example.com', password: 'pw-a' })
      await vi.waitFor(() => expect(accountAStarted).toBe(true))
      const accountBLogin = adapter.login({ username: 'morpheus@example.com', password: 'pw-b' })
      await expect(accountBLogin).resolves.toEqual({ ok: true })
      releaseAccountA(jsonResponse(envelope(authPayload())))

      await expect(accountALogin).resolves.toMatchObject({ ok: false, needs2fa: false })
      expect(binding.getCredential()).toEqual({ username: 'morpheus', accessKey: 'key-b' })
      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000002')
      expect(binding.getAttemptedAccountIds()).toEqual(['a1b2c3d4-0000-0000-0000-000000000002'])
      expect(identities.at(-1)).toBe('a1b2c3d4-0000-0000-0000-000000000002')
    })

    it('does not let a held direct login resurrect the session after explicit logout', async () => {
      let releaseLogin!: (response: Response) => void
      let loginStarted = false
      const heldLogin = new Promise<Response>((resolve) => {
        releaseLogin = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          loginStarted = true
          return heldLogin
        })
      )
      const store = fakeStore()
      const identities: Array<string | null> = []
      let socketCalls = 0
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId),
        socketFactory: () => {
          socketCalls += 1
          return { on: () => {}, close: () => {} }
        }
      })
      const unsubscribe = adapter.subscribe(() => {})

      const login = adapter.login(creds)
      await vi.waitFor(() => expect(loginStarted).toBe(true))
      adapter.clearSession()
      releaseLogin(jsonResponse(envelope(authPayload())))

      await expect(login).resolves.toMatchObject({ ok: false, needs2fa: false })
      await new Promise((resolve) => setImmediate(resolve))
      const socketCount = socketCalls
      unsubscribe()
      expect(store.saved).toEqual([])
      expect(store.deleted).toBe(1)
      expect(identities).not.toContain('a1b2c3d4-0000-0000-0000-000000000001')
      expect(socketCount).toBe(0)
    })

    it('rolls back direct login when credential persistence fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(envelope(authPayload())))
        .mockResolvedValueOnce(
          jsonResponse(
            envelope(
              authPayload({
                username: 'morpheus',
                accessKey: 'key-2',
                userId: 'a1b2c3d4-0000-0000-0000-000000000002'
              })
            )
          )
        )
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<CVRCredentials>()
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      let deleteCalls = 0
      binding.store.delete = () => {
        deleteCalls++
        throw new Error('credential deletion failed')
      }
      const restartPipeline = vi.spyOn(
        adapter as unknown as { restartPipeline: () => void },
        'restartPipeline'
      )

      await adapter.login(creds)
      restartPipeline.mockClear()
      binding.failNextSave()
      await expect(adapter.login(creds)).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      expect(binding.getCredential()).toEqual({ username: 'trinity', accessKey: 'key-1' })
      expect(binding.getOwner()).toBeNull()
      expect(binding.getAttemptedAccountIds().at(-1)).toBe('a1b2c3d4-0000-0000-0000-000000000002')
      expect(deleteCalls).toBe(1)
      expect(identities).not.toContain('a1b2c3d4-0000-0000-0000-000000000002')
      expect(restartPipeline).not.toHaveBeenCalled()
    })

    it('authenticates, persists ONLY username+accessKey, reports authenticated status', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const result = await adapter.login(creds)

      expect(result).toEqual({ ok: true })
      expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-1' }])
      // The password must appear nowhere in the persisted session.
      expect(JSON.stringify(store.saved)).not.toContain(creds.password)
      // A fresh login proved the credentials — a status check trusts it WITHOUT
      // a second auth call (VRX-190: re-authing here rotated CVR's key and
      // logged the user out on navigation).
      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'authenticated',
        displayName: 'trinity',
        accountId: 'a1b2c3d4-0000-0000-0000-000000000001'
      })
      expect(identities.at(-1)).toBe('a1b2c3d4-0000-0000-0000-000000000001')
      expect(fetchMock).toHaveBeenCalledTimes(1) // login only — no reauth probe
      const loginCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const loginBody = JSON.parse(loginCall[1].body as string) as Record<string, unknown>
      expect(loginBody.AuthType).toBe(2) // password login leg
    })

    it('clears captured identity on logout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      )
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(fakeStore(), instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      await adapter.login(creds)
      adapter.clearSession()

      expect(identities).toEqual([null, 'a1b2c3d4-0000-0000-0000-000000000001', null])
      expect(await adapter.getAuthStatus()).toMatchObject({ accountId: null })
    })

    it('the session STICKS across repeated status checks — no reauth churn (VRX-190)', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission())

      expect(await adapter.login(creds)).toEqual({ ok: true })
      // Navigating away and back re-checks status many times; every check must
      // stay authenticated and NONE may hit the wire (the reported v0.4.0 bug).
      for (let i = 0; i < 5; i++) {
        expect((await adapter.getAuthStatus()).state).toBe('authenticated')
      }
      expect(fetchMock).toHaveBeenCalledTimes(1) // still just the one login call
    })

    it('login punches through an OPEN circuit breaker — "cannot connect" bug (VRX-190)', async () => {
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      // Trip the shared breaker with 3 background data-call network failures
      // (each records a circuit failure via the guarded request path).
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline')))
      )
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      }
      // Circuit is now open. A deliberate login must STILL reach the wire — it
      // resets the breaker first (without the fix this returns network_error).
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      )
      expect(await adapter.login(creds)).toEqual({ ok: true })
    })

    it('wrong password (401) → invalid_credentials, nothing persisted, login stays retryable', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(jsonResponse({ message: 'nope' }, { status: 401 }))
      )
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new CvrAdapter(store, instantAdmission())

      // Three wrong attempts must NOT trip a circuit breaker (the raw leg).
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await adapter.login(creds)
        expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
      }
      expect(fetchMock).toHaveBeenCalledTimes(3) // every attempt reached the wire
      expect(store.saved).toEqual([])
    })

    it('server error → http_<status>; network failure → network_error', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, { status: 503 })))
      const log = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission(), { log })
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'http_503'
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline username@example.com access-key')))
      )
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'network_error'
      })
      expect(log.mock.calls).toEqual([['warn', 'cvr login: request failed']])
      expect(JSON.stringify(log.mock.calls)).not.toContain('username@example.com')
    })

    it('says a sign-in was rate limited after one request, without resending the password', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
      )
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission(), { log: vi.fn() })

      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'rate_limited'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('sends no sign-in while a rate limit is cooling down, and says so', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(10_000)
        const admission = new ApiAdmissionController()
        admission.deferUntil(20_000)
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const adapter = new CvrAdapter(fakeStore(), admission, { log: vi.fn() })

        await expect(adapter.login(creds)).resolves.toEqual({
          ok: false,
          needs2fa: false,
          error: 'rate_limited'
        })
        await vi.advanceTimersByTimeAsync(15_000)
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('malformed envelope → unexpected_response (never a false success)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'ok', data: { nope: true } })))
      )
      const store = fakeStore()
      const adapter = new CvrAdapter(store, instantAdmission())
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'unexpected_response'
      })
      expect(store.saved).toEqual([])
    })

    it.each(['bad:id', 'bad id', 'bad\nid'])(
      'rejects malformed current-user userId %j',
      async (userId) => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload({ userId }))))
        )
        const store = fakeStore()

        expect(await new CvrAdapter(store, instantAdmission()).login(creds)).toEqual({
          ok: false,
          needs2fa: false,
          error: 'unexpected_response'
        })
        expect(store.saved).toEqual([])
      }
    )

    it('control characters in credentials are rejected BEFORE any request (header injection guard)', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission())

      for (const bad of [
        { username: 'a@b.c\r\nAccessKey: forged', password: 'x' },
        { username: 'a@b.c', password: 'pass\nword' },
        { username: 'a@b.c\u0000', password: 'x' },
        { username: '   ', password: 'x' }
      ]) {
        expect(await adapter.login(bad)).toEqual({
          ok: false,
          needs2fa: false,
          error: 'invalid_credentials'
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a stray twoFactorCode is rejected — CVR has no 2FA leg', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission())
      expect(await adapter.login({ ...creds, twoFactorCode: '123456' })).toEqual({
        ok: false,
        needs2fa: false,
        error: 'unsupported_2fa'
      })
      expect(await adapter.verify2fa()).toEqual({
        ok: false,
        needs2fa: false,
        error: 'unsupported_2fa'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
