import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { AuthSessionPendingError } from './errors'
import { jsonResponse, instantAdmission, ownerBindingHarness } from './__testutils__/adapterTestKit'
import { fakeStore, creds, lastCall, headerOf } from './__testutils__/vrcAdapterTestKit'

describe('VrcAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getAuthStatus & session restore', () => {
    it('does not adopt or send a persisted cookie containing non-printable bytes', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(
        fakeStore('auth=clean;\r\ntwoFactorAuth=also-clean'),
        instantAdmission()
      )

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('quarantines an unowned restored cookie from authenticated consumers', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      let dials = 0
      const adapter = new VrcAdapter(fakeStore('auth=restored'), instantAdmission(), {
        socketFactory: () => {
          dials += 1
          return { on: () => {}, close: () => {} }
        }
      })

      const unsubscribe = adapter.subscribe(() => {})
      await new Promise((resolve) => setImmediate(resolve))

      expect(adapter.getAuthCookieHeader()).toBeNull()
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(AuthSessionPendingError)
      await expect(
        adapter.selfInvite('wrld_pending:11111~private(usr_self)')
      ).rejects.toBeInstanceOf(AuthSessionPendingError)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(dials).toBe(0)
      unsubscribe()
    })

    it('backfills the owner for the restored ciphertext after validation', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness('auth=restored')
      let dials = 0
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          dials += 1
          return { on: () => {}, close: () => {} }
        }
      })
      const unsubscribe = adapter.subscribe(() => {})
      await new Promise((resolve) => setImmediate(resolve))

      expect(dials).toBe(0)
      expect(adapter.getAuthCookieHeader()).toBeNull()

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })

      expect(binding.getCredential()).toBe('auth=restored')
      expect(binding.getOwner()).toBe('ACCOUNT001')
      expect(adapter.getAuthCookieHeader()).toBe('auth=restored')
      await vi.waitFor(() => expect(dials).toBe(1))
      unsubscribe()
    })

    it('fails closed when a validated restored session cannot persist its owner binding', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore('auth=restored')
      store.save = vi.fn(() => {
        throw new Error('secure store unavailable')
      })
      const log = vi.fn()
      const onIdentity = vi.fn()
      let dials = 0
      const adapter = new VrcAdapter(store, instantAdmission(), {
        log,
        onIdentity,
        socketFactory: () => {
          dials += 1
          return { on: () => {}, close: () => {} }
        }
      })
      const unsubscribe = adapter.subscribe(() => {})
      await new Promise((resolve) => setImmediate(resolve))
      expect(dials).toBe(0)

      await expect(adapter.getAuthStatus()).resolves.toEqual({
        platform: 'vrchat',
        state: 'unauthenticated',
        displayName: null,
        accountId: null
      })

      expect(store.deleted).toBe(1)
      expect(adapter.getAuthCookieHeader()).toBeNull()
      expect(onIdentity).not.toHaveBeenCalledWith('ACCOUNT001')
      expect(log.mock.calls).toEqual([['warn', 'vrc adapter: credential persistence failed']])
      expect(dials).toBe(0)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(dials).toBe(0)
      unsubscribe()
    })

    it('does not re-persist or clear an already durable direct-login session during status refresh', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT001', displayName: 'Account A' },
            { setCookies: ['auth=account-a'] }
          )
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, instantAdmission())

      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      store.save = vi.fn(() => {
        throw new Error('secure store temporarily unavailable')
      })

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'ACCOUNT001'
      })
      expect(store.saved).toEqual(['auth=account-a'])
      expect(store.deleted).toBe(0)
      expect(adapter.getAuthCookieHeader()).toBe('auth=account-a')
    })

    it('restores a persisted cookie and sends it on the status check', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'usr', displayName: 'Restored' }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=restored'), instantAdmission())

      const status = await adapter.getAuthStatus()

      expect(status).toEqual({
        platform: 'vrchat',
        state: 'authenticated',
        displayName: 'Restored',
        accountId: 'usr'
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
              { id: 'NEWACCT01', displayName: 'New Account' },
              { setCookies: ['auth=new-account'] }
            )
          )
        }
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=old-account') {
          oldStatusStarted = true
          return heldOldStatus
        }
        if (href.endsWith('/auth/user') && headers.Cookie === 'auth=new-account') {
          return Promise.resolve(jsonResponse({ id: 'NEWACCT01', displayName: 'New Account' }))
        }
        return Promise.reject(new Error('unexpected request'))
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore('auth=old-account')
      const adapter = new VrcAdapter(store, instantAdmission())

      const status = adapter.getAuthStatus()
      await vi.waitFor(() => expect(oldStatusStarted).toBe(true))
      adapter.clearSession()
      expect(await adapter.login({ username: 'new-account', password: 'pw' })).toEqual({ ok: true })

      releaseOldStatus(
        staleStatus === 401
          ? jsonResponse({ error: 'old session expired' }, { status: 401 })
          : jsonResponse({ id: 'OLDACCT01', displayName: 'Old Account' })
      )

      await expect(status).resolves.toEqual({
        platform: 'vrchat',
        state: 'authenticated',
        displayName: 'New Account',
        accountId: 'NEWACCT01'
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

    it('lets an interactive login finish after automatic invalidation clears the restored session', async () => {
      let releaseStatus!: (response: Response) => void
      let releaseLogin!: (response: Response) => void
      let statusStarted = false
      let loginStarted = false
      const heldStatus = new Promise<Response>((resolve) => {
        releaseStatus = resolve
      })
      const heldLogin = new Promise<Response>((resolve) => {
        releaseLogin = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (headers.Authorization !== undefined) {
            loginStarted = true
            return heldLogin
          }
          if (headers.Cookie === 'auth=account-a') {
            statusStarted = true
            return heldStatus
          }
          return Promise.reject(new Error('Unexpected auth request'))
        })
      )
      const binding = ownerBindingHarness<string>('auth=account-a')
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const status = adapter.getAuthStatus()
      await vi.waitFor(() => expect(statusStarted).toBe(true))
      const login = adapter.login({ username: 'account-b', password: 'pw-b' })
      await vi.waitFor(() => expect(loginStarted).toBe(true))

      releaseStatus(jsonResponse({ error: 'expired account A' }, { status: 401 }))
      await expect(status).resolves.toMatchObject({ state: 'unauthenticated' })
      releaseLogin(
        jsonResponse(
          { id: 'ACCOUNT002', displayName: 'Account B' },
          { setCookies: ['auth=account-b'] }
        )
      )

      await expect(login).resolves.toEqual({ ok: true })
      expect(binding.getCredential()).toBe('auth=account-b')
      expect(binding.getOwner()).toBe('ACCOUNT002')
      expect(binding.getAttemptedAccountIds()).toEqual(['ACCOUNT002'])
      expect(identities.at(-1)).toBe('ACCOUNT002')
    })

    it('keeps the auth component through a stale restored-session 401 while 2FA verification is in flight', async () => {
      let releaseStatus!: (response: Response) => void
      let releaseVerifyBody!: (body: unknown) => void
      let statusStarted = false
      let verifyBodyStarted = false
      const heldStatus = new Promise<Response>((resolve) => {
        releaseStatus = resolve
      })
      const heldVerifyBody = new Promise<unknown>((resolve) => {
        releaseVerifyBody = resolve
      })
      const verifyResponse = jsonResponse(null, { setCookies: ['twoFactorAuth=fresh'] })
      vi.spyOn(verifyResponse, 'json').mockImplementation(() => {
        verifyBodyStarted = true
        return heldVerifyBody
      })
      let statusRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.includes('/twofactorauth/')) return Promise.resolve(verifyResponse)
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=stale'
          ) {
            statusRequests += 1
            if (statusRequests === 1) {
              return Promise.resolve(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
            }
            statusStarted = true
            return heldStatus
          }
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=fresh'
          ) {
            return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
          }
          return Promise.reject(new Error(`Unexpected auth request: ${href}`))
        })
      )
      const store = fakeStore('auth=restored; twoFactorAuth=stale')
      const adapter = new VrcAdapter(store, instantAdmission())

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      const staleStatus = adapter.getAuthStatus()
      await vi.waitFor(() => expect(statusStarted).toBe(true))
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(verifyBodyStarted).toBe(true))

      releaseStatus(jsonResponse({ error: 'stale request rejected' }, { status: 401 }))
      await expect(staleStatus).resolves.toMatchObject({ state: 'needs-2fa' })
      releaseVerifyBody({ verified: true })
      await expect(verify).resolves.toEqual({ ok: true })
      expect(store.saved.at(-1)).toBe('auth=restored; twoFactorAuth=fresh')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'ACCOUNT001'
      })
    })

    it('clears the tentative marker after a rejected 2FA code so the restored session remains retryable', async () => {
      let statusRequests = 0
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.includes('/twofactorauth/')) {
          return Promise.resolve(jsonResponse({ error: 'invalid code' }, { status: 401 }))
        }
        if (href.endsWith('/auth/user')) {
          statusRequests += 1
          return Promise.resolve(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
        }
        return Promise.reject(new Error(`Unexpected auth request: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(
        fakeStore('auth=restored; twoFactorAuth=stale'),
        instantAdmission()
      )

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      await expect(adapter.verify2fa('wrong-code')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'invalid_2fa_code'
      })
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      expect(statusRequests).toBe(2)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('does not let a pre-verify 200 status response publish identity during 2FA persistence', async () => {
      let releaseStatus!: (response: Response) => void
      let releaseVerifyBody!: (body: unknown) => void
      let statusStarted = false
      let verifyBodyStarted = false
      const heldStatus = new Promise<Response>((resolve) => {
        releaseStatus = resolve
      })
      const heldVerifyBody = new Promise<unknown>((resolve) => {
        releaseVerifyBody = resolve
      })
      const verifyResponse = jsonResponse(null, { setCookies: ['twoFactorAuth=fresh'] })
      vi.spyOn(verifyResponse, 'json').mockImplementation(() => {
        verifyBodyStarted = true
        return heldVerifyBody
      })
      let statusRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.includes('/twofactorauth/')) return Promise.resolve(verifyResponse)
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=stale'
          ) {
            statusRequests += 1
            if (statusRequests === 1) {
              return Promise.resolve(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
            }
            statusStarted = true
            return heldStatus
          }
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=fresh'
          ) {
            return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
          }
          return Promise.reject(new Error(`Unexpected auth request: ${href}`))
        })
      )
      const store = fakeStore('auth=restored; twoFactorAuth=stale')
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      const identitiesBeforeStatus = [...identities]

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      const staleStatus = adapter.getAuthStatus()
      await vi.waitFor(() => expect(statusStarted).toBe(true))
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(verifyBodyStarted).toBe(true))

      releaseStatus(jsonResponse({ id: 'STALE001', displayName: 'Stale Account' }))
      await expect(staleStatus).resolves.toMatchObject({ state: 'needs-2fa' })
      expect(store.saved).toEqual([])
      expect(identities).toEqual(identitiesBeforeStatus)

      releaseVerifyBody({ verified: true })
      await expect(verify).resolves.toEqual({ ok: true })
      expect(store.saved.at(-1)).toBe('auth=restored; twoFactorAuth=fresh')
      expect(identities.at(-1)).toBe('ACCOUNT001')
    })

    it('does not let a pre-verify 200 status body publish identity during 2FA persistence', async () => {
      let releaseStatusBody!: (body: unknown) => void
      let releaseVerifyBody!: (body: unknown) => void
      let statusBodyStarted = false
      let verifyBodyStarted = false
      const heldStatusBody = new Promise<unknown>((resolve) => {
        releaseStatusBody = resolve
      })
      const heldVerifyBody = new Promise<unknown>((resolve) => {
        releaseVerifyBody = resolve
      })
      const staleStatusResponse = jsonResponse(null)
      vi.spyOn(staleStatusResponse, 'json').mockImplementation(() => {
        statusBodyStarted = true
        return heldStatusBody
      })
      const verifyResponse = jsonResponse(null, { setCookies: ['twoFactorAuth=fresh'] })
      vi.spyOn(verifyResponse, 'json').mockImplementation(() => {
        verifyBodyStarted = true
        return heldVerifyBody
      })
      let statusRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.includes('/twofactorauth/')) return Promise.resolve(verifyResponse)
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=stale'
          ) {
            statusRequests += 1
            return statusRequests === 1
              ? Promise.resolve(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
              : Promise.resolve(staleStatusResponse)
          }
          if (
            href.endsWith('/auth/user') &&
            headers.Cookie === 'auth=restored; twoFactorAuth=fresh'
          ) {
            return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
          }
          return Promise.reject(new Error(`Unexpected auth request: ${href}`))
        })
      )
      const store = fakeStore('auth=restored; twoFactorAuth=stale')
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      const identitiesBeforeStatus = [...identities]

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      const staleStatus = adapter.getAuthStatus()
      await vi.waitFor(() => expect(statusBodyStarted).toBe(true))
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(verifyBodyStarted).toBe(true))

      releaseStatusBody({ id: 'STALE001', displayName: 'Stale Account' })
      await expect(staleStatus).resolves.toMatchObject({ state: 'needs-2fa' })
      expect(store.saved).toEqual([])
      expect(identities).toEqual(identitiesBeforeStatus)

      releaseVerifyBody({ verified: true })
      await expect(verify).resolves.toEqual({ ok: true })
      expect(store.saved.at(-1)).toBe('auth=restored; twoFactorAuth=fresh')
      expect(identities.at(-1)).toBe('ACCOUNT001')
    })

    it('reports unauthenticated WITHOUT a network call when there is no cookie', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const status = await new VrcAdapter(fakeStore(), instantAdmission()).getAuthStatus()

      expect(status).toEqual({
        platform: 'vrchat',
        state: 'unauthenticated',
        displayName: null,
        accountId: null
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps a 401 to unauthenticated and a network failure to error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 })))
      expect(
        await new VrcAdapter(fakeStore('auth=x'), instantAdmission()).getAuthStatus()
      ).toMatchObject({
        state: 'unauthenticated'
      })

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(
        await new VrcAdapter(fakeStore('auth=x'), instantAdmission()).getAuthStatus()
      ).toMatchObject({
        state: 'error'
      })
    })

    it('marks only a check that got no answer as unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(
        await new VrcAdapter(fakeStore('auth=x'), instantAdmission()).getAuthStatus()
      ).toMatchObject({ state: 'error', unreachable: true })

      // VRChat answered and refused: never re-checked from the tray.
      for (const status of [403, 500, 429]) {
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.resolve(jsonResponse({}, { status })))
        )
        const result = await new VrcAdapter(fakeStore('auth=x'), instantAdmission()).getAuthStatus()
        expect(result.state).toBe('error')
        expect(result.unreachable).toBeUndefined()
      }
    })

    it('repeated network validation failures do not block a subsequent correct login', async () => {
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

      for (let i = 0; i < 3; i++) {
        expect((await adapter.getAuthStatus()).state).toBe('error')
      }

      const loginFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: 'usr', displayName: 'Neo' }, { setCookies: ['auth=fresh'] })
        )
      vi.stubGlobal('fetch', loginFetch)

      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect(loginFetch).toHaveBeenCalledTimes(1)
    })

    it('login punches through an OPEN circuit breaker tripped by DATA calls (VRX-190 parity)', async () => {
      // Trip the shared breaker via the guarded data path (getFriends), then
      // prove a deliberate login still reaches the wire — resetCircuit() runs
      // first, mirroring CvrAdapter.login (parity gap caught on VRX-189).
      const adapter = new VrcAdapter(fakeStore('auth=x'), instantAdmission())
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      }

      const loginFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: 'usr', displayName: 'Neo' }, { setCookies: ['auth=fresh'] })
        )
      vi.stubGlobal('fetch', loginFetch)
      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect(loginFetch).toHaveBeenCalled()
    })

    it('maps a 200 with an unparseable/drifted body to error WITHOUT clearing the session (VRX-201)', async () => {
      // The body is garbage but the server said 200 — the cookie may be fine
      // (a live API outage/schema drift, not a dead session); nuking the
      // persisted session here would force a full re-login over a blip, and
      // reporting 'unauthenticated' would wrongly surface the login gate.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ totally: 'wrong' })))
      const store = fakeStore('auth=x')

      expect(await new VrcAdapter(store, instantAdmission()).getAuthStatus()).toMatchObject({
        state: 'error'
      })
      expect(store.deleted).toBe(0)
    })

    it('returns a null accountId after login when a later 200 auth body is unparseable (VRX-201)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT001', displayName: 'Account A' },
            { setCookies: ['auth=account-a'] }
          )
        )
        .mockResolvedValueOnce(jsonResponse({ totally: 'wrong' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, instantAdmission())

      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect(await adapter.getAuthStatus()).toEqual({
        platform: 'vrchat',
        state: 'error',
        displayName: null,
        accountId: null
      })
      expect(store.deleted).toBe(0)
      expect(await adapter.getAuthStatus()).toMatchObject({
        state: 'authenticated',
        accountId: 'ACCOUNT001'
      })
      expect(headerOf(lastCall(fetchMock)[1], 'Cookie')).toBe('auth=account-a')
    })

    it('reports needs-2fa (method totp) when only the second factor expired — session KEPT (VRX-173)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ requiresTwoFactorAuth: ['totp', 'otp'] }))
      )
      const store = fakeStore('auth=tok1; twoFactorAuth=stale')
      const adapter = new VrcAdapter(store, instantAdmission())

      const status = await adapter.getAuthStatus()

      expect(status).toEqual({
        platform: 'vrchat',
        state: 'needs-2fa',
        displayName: null,
        accountId: null,
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
          Promise.resolve(jsonResponse({ id: 'TRINITY09', displayName: 'Trinity' }))
        )
      vi.stubGlobal('fetch', fetchMock)
      // Restored session cookie is the COMBINED string from the last full login.
      const store = fakeStore('auth=tok1; twoFactorAuth=stale')
      const adapter = new VrcAdapter(store, instantAdmission())

      expect(await adapter.getAuthStatus()).toMatchObject({
        state: 'needs-2fa',
        twoFactorMethod: 'email'
      })

      // The reprompt method came from getAuthStatus (login() never ran) — the
      // verify must route to /emailotp/verify (VRX-229: otp/verify is the
      // recovery-code endpoint and rejects email codes), not the totp default.
      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })
      expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toMatch(
        /\/auth\/twofactorauth\/emailotp\/verify$/
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
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      // The dead cookie was wiped from disk so session restore can't re-adopt it.
      expect(store.deleted).toBe(1)
      expect(store.load()).toBeUndefined()
      expect(identities.at(-1)).toBeNull()

      // Proof the in-memory cookie + VrcApiClient mirror are gone: the next
      // status check short-circuits to unauthenticated with NO network call.
      fetchMock.mockClear()
      expect(await adapter.getAuthStatus()).toEqual({
        platform: 'vrchat',
        state: 'unauthenticated',
        displayName: null,
        accountId: null,
        endedByPlatform: true
      })
      expect(fetchMock).not.toHaveBeenCalled()

      // Proof the persisted blob is gone too — a FRESH adapter (the next launch)
      // built on the same store finds nothing to restore and never hits the wire.
      const relaunched = new VrcAdapter(store, instantAdmission())
      expect(await relaunched.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('says VRChat ended the session until the user signs out', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 })))
      const adapter = new VrcAdapter(fakeStore('auth=expired'), instantAdmission())

      expect(await adapter.getAuthStatus()).toMatchObject({
        state: 'unauthenticated',
        endedByPlatform: true
      })
      // A sign-out the user chose never reads as VRChat's doing.
      adapter.clearSession()
      expect(await adapter.getAuthStatus()).not.toHaveProperty('endedByPlatform')
    })

    it('forgets that VRChat ended the session once the user signs in again', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, { status: 401 })))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore('auth=expired'), instantAdmission())
      expect(await adapter.getAuthStatus()).toMatchObject({ endedByPlatform: true })

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ id: 'ACCOUNT002', displayName: 'Again' }, { setCookies: ['auth=fresh'] })
        )
      )
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      const status = await adapter.getAuthStatus()
      expect(status.state).toBe('authenticated')
      expect(status).not.toHaveProperty('endedByPlatform')
    })

    it('never says VRChat ended a session it did not hold', async () => {
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())
      expect(await adapter.getAuthStatus()).not.toHaveProperty('endedByPlatform')
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
      const adapter = new VrcAdapter(store, instantAdmission())

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
        vi.fn().mockResolvedValue(jsonResponse({ id: 'CURRENT01', displayName: 'Current' }))
      )
      const adapter = new VrcAdapter(store, instantAdmission())

      expect(() => adapter.clearSession()).toThrow('credential deletion failed')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'CURRENT01',
        displayName: 'Current'
      })
    })
  })
})
