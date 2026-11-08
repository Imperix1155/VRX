import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_IDENTITY_UNAVAILABLE, type AdapterEvent } from '@shared/types'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { jsonResponse, instantAdmission, ownerBindingHarness } from './__testutils__/adapterTestKit'
import { FriendAlerts, type FriendAlert } from '../friendAlerts'
import { AccountSession } from '../accountSession'
import {
  fakeStore,
  creds,
  DrivableVrcSocket,
  pipelineFrame,
  pipelineUser,
  lastCall,
  headerOf
} from './__testutils__/vrcAdapterTestKit'

describe('VrcAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('login (no 2FA)', () => {
    it('binds the owner on first login into an empty credential slot', async () => {
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
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission())

      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('ACCOUNT001')
    })

    it('refuses a legacy id VRX cannot keep before saving the session', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(
              { id: 'legacy.user', displayName: 'Legacy' },
              { setCookies: ['auth=legacy-session'] }
            )
          )
      )
      const store = fakeStore()
      const accountSession = new AccountSession()
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => accountSession.setIdentity('vrchat', accountId)
      })

      await expect(adapter.login(creds)).resolves.toMatchObject({
        ok: false,
        error: 'unexpected_response'
      })
      expect(store.saved).toEqual([])
      expect(accountSession.getAccountId('vrchat')).toBeNull()
    })

    it('rebinds an A-to-B replacement to B after the new credential is persisted', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT001', displayName: 'Account A' },
            { setCookies: ['auth=account-a'] }
          )
        )
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT002', displayName: 'Account B' },
            { setCookies: ['auth=account-b'] }
          )
        )
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission())

      await adapter.login(creds)
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('ACCOUNT002')
    })

    it('rejects an account-changing login that does not issue a replacement auth cookie', async () => {
      const sockets: DrivableVrcSocket[] = []
      const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (href.endsWith('/auth')) {
          return Promise.resolve(jsonResponse({ token: 'account-a-pipeline' }))
        }
        if (headers.Authorization !== undefined) {
          return Promise.resolve(jsonResponse({ id: 'ACCOUNT002', displayName: 'Account B' }))
        }
        if (headers.Cookie === 'auth=account-a') {
          return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
        }
        return Promise.reject(new Error(`Unexpected URL: ${href}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>('auth=account-a')
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId),
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'ACCOUNT001'
      })
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )
      const unsubscribe = adapter.subscribe(() => {})
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      createPipeline.mockClear()

      const result = await adapter.login({ username: 'account-b', password: 'pw-b' })
      const oldSocketClosed = sockets[0]!.closed
      const replacementCount = createPipeline.mock.calls.length
      unsubscribe()

      expect(result).toEqual({ ok: false, needs2fa: false, error: 'unexpected_response' })
      expect(binding.getCredential()).toBe('auth=account-a')
      expect(binding.getAttemptedAccountIds()).toEqual(['ACCOUNT001'])
      expect(binding.getOwner()).toBe('ACCOUNT001')
      expect(identities.at(-1)).toBe('ACCOUNT001')
      expect(replacementCount).toBe(0)
      expect(sockets).toHaveLength(1)
      expect(oldSocketClosed).toBe(false)
    })

    it('rolls back direct login when credential persistence fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT001', displayName: 'Account A' },
            { setCookies: ['auth=account-a'] }
          )
        )
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT002', displayName: 'Account B' },
            { setCookies: ['auth=account-b'] }
          )
        )
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>()
      const identities: Array<string | null> = []
      const log = vi.fn()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId),
        log
      })
      let deleteCalls = 0
      binding.store.delete = () => {
        deleteCalls++
        throw new Error('credential deletion failed')
      }

      await adapter.login(creds)
      binding.failNextSave()
      await expect(adapter.login(creds)).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      expect(binding.getCredential()).toBe('auth=account-a')
      expect(binding.getOwner()).toBeNull()
      expect(binding.getAttemptedAccountIds().at(-1)).toBe('ACCOUNT002')
      expect(deleteCalls).toBe(1)
      expect(identities).not.toContain('ACCOUNT002')
      expect(log.mock.calls).toEqual([['warn', 'vrc adapter: credential persistence failed']])
    })

    it('does not publish a tentative direct-login cookie through auth status', async () => {
      let releaseBody!: (body: unknown) => void
      let bodyStarted = false
      const heldBody = new Promise<unknown>((resolve) => {
        releaseBody = resolve
      })
      const loginResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(loginResponse, 'json').mockImplementation(() => {
        bodyStarted = true
        return heldBody
      })
      const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
        const headers = (options?.headers ?? {}) as Record<string, string>
        if (headers.Authorization !== undefined) return Promise.resolve(loginResponse)
        return Promise.reject(new Error('Unexpected non-login request'))
      })
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>()
      binding.failNextSave()
      const adapter = new VrcAdapter(binding.store, instantAdmission())

      const login = adapter.login(creds)
      await vi.waitFor(() => expect(bodyStarted).toBe(true))
      expect(adapter.getAuthCookieHeader()).toBeNull()
      const status = adapter.getAuthStatus()
      let statusSettled = false
      void status.then(() => {
        statusSettled = true
      })
      await expect(adapter.getFriends()).rejects.toThrow(
        'Authentication session is still being persisted'
      )
      await expect(adapter.selfInvite('wrld_pending:11111~private(usr_self)')).rejects.toThrow(
        'Authentication session is still being persisted'
      )
      await new Promise((resolve) => setImmediate(resolve))

      expect(statusSettled).toBe(false)
      expect(fetchMock).toHaveBeenCalledOnce()

      releaseBody({ id: 'ACCOUNT001', displayName: 'Account A' })
      await expect(login).resolves.toMatchObject({
        ok: false,
        error: 'credential_persistence_failed'
      })
      await expect(status).resolves.toMatchObject({ state: 'unauthenticated' })
    })

    it('keeps a subscribed pipeline stopped when direct-login persistence fails', async () => {
      let loginCalls = 0
      const sockets: DrivableVrcSocket[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.endsWith('/auth')) {
            return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
          }
          if (headers.Authorization !== undefined) {
            loginCalls += 1
            return Promise.resolve(
              jsonResponse(
                {
                  id: loginCalls === 1 ? 'ACCOUNT001' : 'ACCOUNT002',
                  displayName: loginCalls === 1 ? 'Account A' : 'Account B'
                },
                { setCookies: [`auth=account-${loginCalls === 1 ? 'a' : 'b'}`] }
              )
            )
          }
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })

      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      const unsubscribe = adapter.subscribe(() => {})
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )
      binding.failNextSave()

      const result = await adapter.login(creds)
      const replacementPipelineCount = createPipeline.mock.calls.length
      const socketCount = sockets.length
      const oldSocketClosed = sockets[0]!.closed
      unsubscribe()

      expect(result).toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect(replacementPipelineCount).toBe(0)
      expect(socketCount).toBe(1)
      expect(oldSocketClosed).toBe(true)
    })

    it('makes the later overlapping direct login win without persisting the held account', async () => {
      let releaseAccountABody!: (body: unknown) => void
      let accountABodyStarted = false
      const accountABody = new Promise<unknown>((resolve) => {
        releaseAccountABody = resolve
      })
      const accountAResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(accountAResponse, 'json').mockImplementation(() => {
        accountABodyStarted = true
        return accountABody
      })
      let directLoginCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (headers.Authorization === undefined) {
            return Promise.reject(new Error('Unexpected non-login request'))
          }
          directLoginCalls += 1
          return Promise.resolve(
            directLoginCalls === 1
              ? accountAResponse
              : jsonResponse(
                  { id: 'ACCOUNT002', displayName: 'Account B' },
                  { setCookies: ['auth=account-b'] }
                )
          )
        })
      )
      const binding = ownerBindingHarness<string>()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const accountALogin = adapter.login({ username: 'account-a', password: 'pw-a' })
      await vi.waitFor(() => expect(accountABodyStarted).toBe(true))
      const accountBLogin = adapter.login({ username: 'account-b', password: 'pw-b' })
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      releaseAccountABody({ id: 'ACCOUNT001', displayName: 'Account A' })

      await expect(Promise.all([accountALogin, accountBLogin])).resolves.toEqual([
        {
          ok: false,
          needs2fa: false,
          error: 'unexpected_response',
          sessionCleared: true
        },
        { ok: true }
      ])
      expect(binding.getCredential()).toBe('auth=account-b')
      expect(binding.getAttemptedAccountIds()).toEqual(['ACCOUNT002'])
      expect(binding.getOwner()).toBe('ACCOUNT002')
      expect(identities.at(-1)).toBe('ACCOUNT002')
    })

    it('does not persist a held login when the later overlapping login is rejected', async () => {
      let releaseAccountABody!: (body: unknown) => void
      let accountABodyStarted = false
      const accountABody = new Promise<unknown>((resolve) => {
        releaseAccountABody = resolve
      })
      const accountAResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(accountAResponse, 'json').mockImplementation(() => {
        accountABodyStarted = true
        return accountABody
      })
      let directLoginCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (headers.Authorization === undefined) {
            return Promise.reject(new Error('Unexpected non-login request'))
          }
          directLoginCalls += 1
          return Promise.resolve(
            directLoginCalls === 1
              ? accountAResponse
              : jsonResponse({ error: 'invalid credentials' }, { status: 401 })
          )
        })
      )
      const store = fakeStore()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const accountALogin = adapter.login({ username: 'account-a', password: 'pw-a' })
      await vi.waitFor(() => expect(accountABodyStarted).toBe(true))
      const accountBLogin = adapter.login({ username: 'account-b', password: 'wrong' })
      releaseAccountABody({ id: 'ACCOUNT001', displayName: 'Account A' })

      await expect(Promise.all([accountALogin, accountBLogin])).resolves.toEqual([
        {
          ok: false,
          needs2fa: false,
          error: 'unexpected_response',
          sessionCleared: true
        },
        { ok: false, needs2fa: false, error: 'invalid_credentials' }
      ])
      expect(store.saved).toEqual([])
      expect(store.deleted).toBe(1)
      expect(identities).not.toContain('ACCOUNT001')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
    })

    it('does not let a held direct login resurrect a session after explicit logout', async () => {
      let releaseLogin!: (response: Response) => void
      let loginStarted = false
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
          return Promise.reject(new Error('Unexpected non-login request'))
        })
      )
      const store = fakeStore()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const login = adapter.login(creds)
      await vi.waitFor(() => expect(loginStarted).toBe(true))
      adapter.clearSession()
      releaseLogin(
        jsonResponse(
          { id: 'ACCOUNT001', displayName: 'Account A' },
          { setCookies: ['auth=account-a'] }
        )
      )

      await expect(login).resolves.toMatchObject({ ok: false, needs2fa: false })
      expect(store.saved).toEqual([])
      expect(store.deleted).toBe(1)
      expect(identities).not.toContain('ACCOUNT001')
    })

    it('defers a new subscriber while a direct-login body is tentative and save fails', async () => {
      let releaseBody!: (body: unknown) => void
      let bodyStarted = false
      const heldBody = new Promise<unknown>((resolve) => {
        releaseBody = resolve
      })
      const loginResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(loginResponse, 'json').mockImplementation(() => {
        bodyStarted = true
        return heldBody
      })
      const sockets: DrivableVrcSocket[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tentative' }))
          if (headers.Authorization !== undefined) return Promise.resolve(loginResponse)
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      binding.failNextSave()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )

      const login = adapter.login(creds)
      await vi.waitFor(() => expect(bodyStarted).toBe(true))
      const unsubscribe = adapter.subscribe(() => {})
      releaseBody({ id: 'ACCOUNT001', displayName: 'Account A' })
      const result = await login
      const pipelineCount = createPipeline.mock.calls.length
      const socketCount = sockets.length
      unsubscribe()

      expect(result).toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect(pipelineCount).toBe(0)
      expect(socketCount).toBe(0)
    })

    it('keeps a waiting subscriber stopped when tentative direct login is explicitly cleared', async () => {
      let releaseBody!: (body: unknown) => void
      let bodyStarted = false
      const heldBody = new Promise<unknown>((resolve) => {
        releaseBody = resolve
      })
      const loginResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(loginResponse, 'json').mockImplementation(() => {
        bodyStarted = true
        return heldBody
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (headers.Authorization !== undefined) return Promise.resolve(loginResponse)
          return Promise.reject(new Error('Unexpected non-login request'))
        })
      )
      const store = fakeStore('auth=previous')
      const adapter = new VrcAdapter(store, instantAdmission())
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )

      const login = adapter.login(creds)
      await vi.waitFor(() => expect(bodyStarted).toBe(true))
      const unsubscribe = adapter.subscribe(() => {})
      adapter.clearSession()
      const pipelineCount = createPipeline.mock.calls.length
      unsubscribe()
      releaseBody({ id: 'ACCOUNT001', displayName: 'Account A' })

      await expect(login).resolves.toMatchObject({ ok: false, needs2fa: false })
      expect(pipelineCount).toBe(0)
      expect(store.saved).toEqual([])
      expect(store.deleted).toBe(1)
    })

    it('recovers a waiting subscriber after a tentative body is rejected and retry persists', async () => {
      let releaseFirstBody!: (body: unknown) => void
      let firstBodyStarted = false
      const heldFirstBody = new Promise<unknown>((resolve) => {
        releaseFirstBody = resolve
      })
      const firstResponse = jsonResponse(null, { setCookies: ['auth=account-a'] })
      vi.spyOn(firstResponse, 'json').mockImplementation(() => {
        firstBodyStarted = true
        return heldFirstBody
      })
      let directLoginCalls = 0
      const sockets: DrivableVrcSocket[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'account-b' }))
          if (headers.Authorization !== undefined) {
            directLoginCalls += 1
            return Promise.resolve(
              directLoginCalls === 1
                ? firstResponse
                : jsonResponse(
                    { id: 'ACCOUNT002', displayName: 'Account B' },
                    { setCookies: ['auth=account-b'] }
                  )
            )
          }
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )

      const firstLogin = adapter.login({ username: 'account-a', password: 'pw-a' })
      await vi.waitFor(() => expect(firstBodyStarted).toBe(true))
      const unsubscribe = adapter.subscribe(() => {})
      releaseFirstBody({ unexpected: true })
      await expect(firstLogin).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'unexpected_response',
        sessionCleared: true
      })
      await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
        ok: true
      })
      await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0))
      const pipelineCount = createPipeline.mock.calls.length
      const socketCount = sockets.length
      unsubscribe()

      expect(pipelineCount).toBe(1)
      expect(socketCount).toBe(1)
      expect(binding.getCredential()).toBe('auth=account-b')
      expect(binding.getOwner()).toBe('ACCOUNT002')
    })

    it('authenticates, persists ONLY the auth cookie (attributes stripped), reports the display name', async () => {
      // A Response body is single-use, and this test fetches twice (login +
      // getAuthStatus) — return a fresh Response per call.
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { id: 'LEGACY001', displayName: 'Neo' },
            { setCookies: ['auth=abc123; Path=/; HttpOnly; Secure'] }
          )
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const result = await adapter.login(creds)

      expect(result).toEqual({ ok: true })
      expect(store.saved).toEqual(['auth=abc123']) // attributes stripped, password never stored
      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'vrchat',
        state: 'authenticated',
        displayName: 'Neo',
        accountId: 'LEGACY001'
      })
      expect(identities.at(-1)).toBe('LEGACY001')
    })

    it.each(['bad:id', 'bad id', 'bad\nid'])('rejects malformed current-user id %j', async (id) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ id, displayName: 'Neo' }, { setCookies: ['auth=abc123'] })
          )
      )
      const store = fakeStore()

      expect(await new VrcAdapter(store, instantAdmission()).login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'unexpected_response',
        sessionCleared: true
      })
      expect(store.saved).toEqual([])
    })

    it('clears captured identity on logout', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(
              { id: 'LOGOUT001', displayName: 'Logout' },
              { setCookies: ['auth=logout'] }
            )
          )
      )
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(fakeStore(), instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      await adapter.login(creds)
      adapter.clearSession()

      expect(identities).toEqual([null, 'LOGOUT001', null])
      expect(await adapter.getAuthStatus()).toMatchObject({ accountId: null })
    })

    it('sends Basic auth with url-encoded username:password', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)

      await new VrcAdapter(fakeStore(), instantAdmission()).login({
        username: 'a:b@c',
        password: 'p:w@d'
      })

      const expected = `Basic ${Buffer.from('a%3Ab%40c:p%3Aw%40d').toString('base64')}`
      expect(headerOf(lastCall(fetchMock)[1], 'Authorization')).toBe(expected)
    })

    it('preserves Unicode direct-login text in the exact Basic auth value', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)

      await new VrcAdapter(fakeStore(), instantAdmission()).login({
        username: 'ユーザー🔐',
        password: 'pässwörd'
      })

      const encoded = `${encodeURIComponent('ユーザー🔐')}:${encodeURIComponent('pässwörd')}`
      const expected = `Basic ${Buffer.from(encoded).toString('base64')}`
      expect(headerOf(lastCall(fetchMock)[1], 'Authorization')).toBe(expected)
    })

    it('never persists or transmits the password as a cookie', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'X' }, { setCookies: ['auth=t'] }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()

      await new VrcAdapter(store, instantAdmission()).login(creds)

      expect(store.saved.some((v) => v.includes('redpill'))).toBe(false)
    })

    it('maps a 401 to a clean invalid_credentials result', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )
      const result = await new VrcAdapter(fakeStore(), instantAdmission()).login(creds)
      expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    })

    it('does NOT trip the circuit breaker on repeated wrong passwords (regression)', async () => {
      // 401 via request<T> would record 3 failures → "Circuit open" lockout, even
      // with the correct password. Auth goes through rawRequest, so it must not.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 401 }))
      )
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

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
      const result = await new VrcAdapter(fakeStore(), instantAdmission()).login(creds)
      expect(result).toEqual({
        ok: false,
        needs2fa: false,
        error: 'unexpected_response',
        sessionCleared: true
      })
    })

    it('deletes the prior stored credential when a replacement cookie has a malformed body', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ unexpected: true }, { setCookies: ['auth=replacement'] })
          )
      )
      const binding = ownerBindingHarness<string>('auth=previous')

      await expect(new VrcAdapter(binding.store, instantAdmission()).login(creds)).resolves.toEqual(
        {
          ok: false,
          needs2fa: false,
          error: 'unexpected_response',
          sessionCleared: true
        }
      )
      expect(binding.getCredential()).toBeUndefined()
      expect(binding.getOwner()).toBeNull()

      // Restart regression: an adapter built against the same store must not
      // recover the pre-login session after this failed replacement.
      const relaunched = new VrcAdapter(binding.store, instantAdmission())
      expect(await relaunched.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
    })

    it('marks an unreadable replacement response after clearing the prior session', async () => {
      const response = jsonResponse(null, { setCookies: ['auth=replacement'] })
      vi.spyOn(response, 'json').mockRejectedValue(new SyntaxError('invalid json'))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
      const binding = ownerBindingHarness<string>('auth=previous')

      await expect(new VrcAdapter(binding.store, instantAdmission()).login(creds)).resolves.toEqual(
        {
          ok: false,
          needs2fa: false,
          error: 'bad_response',
          sessionCleared: true
        }
      )
      expect(binding.getCredential()).toBeUndefined()
      expect(binding.getOwner()).toBeNull()
    })
  })

  describe('2FA', () => {
    it.each([
      ['fresh session', undefined],
      ['existing account', 'auth=account-a']
    ])(
      'rejects a 2FA prompt without a replacement auth cookie for a %s',
      async (_label, stored) => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(jsonResponse({ requiresTwoFactorAuth: ['totp'] }))
        )
        const store = fakeStore(stored)
        const adapter = new VrcAdapter(store, instantAdmission())

        await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
          ok: false,
          needs2fa: false,
          error: 'unexpected_response'
        })

        expect(store.saved).toEqual([])
        expect(store.deleted).toBe(0)
        expect(adapter.getAuthCookieHeader()).toBeNull()
      }
    )

    it('cannot revive the prior account after a replacement login reaches 2FA and the app restarts', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-b'] })
        )
        // This is what the prior account would return after an unsafe restart.
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>('auth=account-a')

      await expect(
        new VrcAdapter(binding.store, instantAdmission()).login({
          username: 'account-b',
          password: 'pw-b'
        })
      ).resolves.toEqual({ ok: false, needs2fa: true, method: 'totp' })

      // The first leg cannot persist account B yet, but it must durably revoke
      // account A before exposing B's retryable code prompt.
      expect(binding.getCredential()).toBeUndefined()
      await expect(
        new VrcAdapter(binding.store, instantAdmission()).getAuthStatus()
      ).resolves.toMatchObject({
        state: 'unauthenticated'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('fails closed when the prior credential cannot be invalidated before a replacement 2FA prompt', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-b'] })
          )
      )
      const store: VrcCredentialStore = {
        load: () => 'auth=account-a',
        save: () => {},
        delete: () => {
          throw new Error('credential invalidation failed')
        }
      }
      const adapter = new VrcAdapter(store, instantAdmission())

      await expect(adapter.login({ username: 'account-b', password: 'pw-b' })).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect(adapter.getAuthCookieHeader()).toBeNull()
    })

    it('binds the owner only after the verified 2FA credential is persisted', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'TRINITY09', displayName: 'Trinity' }))
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission())

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      expect(adapter.getAuthCookieHeader()).toBeNull()
      await expect(adapter.verify2fa('123456')).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('TRINITY09')
      expect(adapter.getAuthCookieHeader()).toBe('auth=tok1; twoFactorAuth=tf2')
    })

    it('fails closed when verified 2FA cannot establish an account owner', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2'] })
        )
        // A successful verify followed by an unreadable owner response is not
        // authenticated: no unbound durable credential may survive it.
        .mockResolvedValueOnce(jsonResponse({ unexpected: true }))
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>('auth=previous')
      const identities: Array<string | null> = []
      const log = vi.fn()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId),
        log
      })

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      await expect(adapter.verify2fa('123456')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: AUTH_IDENTITY_UNAVAILABLE,
        sessionCleared: true
      })
      expect(binding.getCredential()).toBeUndefined()
      expect(binding.getOwner()).toBeNull()
      expect(binding.getAttemptedAccountIds()).toEqual([])
      expect(identities).not.toContain('TRINITY09')
      expect(log.mock.calls).toEqual([['warn', 'vrc adapter: authenticated identity unavailable']])

      // The restarted adapter has no credential to re-adopt and never probes.
      fetchMock.mockClear()
      expect(await new VrcAdapter(binding.store, instantAdmission()).getAuthStatus()).toMatchObject(
        {
          state: 'unauthenticated'
        }
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rolls back completed 2FA when credential persistence fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { id: 'ACCOUNT001', displayName: 'Account A' },
            { setCookies: ['auth=account-a'] }
          )
        )
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-b'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'ACCOUNT002', displayName: 'Account B' }))
      vi.stubGlobal('fetch', fetchMock)
      const binding = ownerBindingHarness<string>()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      const deleteCredential = vi.spyOn(binding.store, 'delete')

      await adapter.login(creds)
      await adapter.login(creds)
      binding.failNextSave()
      await expect(adapter.verify2fa('123456')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })

      expect(await adapter.getAuthStatus()).toMatchObject({ state: 'unauthenticated' })
      expect(binding.getCredential()).toBeUndefined()
      expect(binding.getOwner()).toBeNull()
      expect(binding.getAttemptedAccountIds().at(-1)).toBe('ACCOUNT002')
      // The first delete revokes any prior account before the 2FA prompt. The
      // second is terminal rollback after the replacement save fails.
      expect(deleteCredential).toHaveBeenCalledTimes(2)
      expect(identities).not.toContain('ACCOUNT002')
    })

    it('does not publish a completed 2FA cookie while owner binding is tentative', async () => {
      let releaseRefreshBody!: (body: unknown) => void
      let refreshBodyStarted = false
      const heldRefreshBody = new Promise<unknown>((resolve) => {
        releaseRefreshBody = resolve
      })
      const refreshResponse = jsonResponse(null)
      vi.spyOn(refreshResponse, 'json').mockImplementation(() => {
        refreshBodyStarted = true
        return heldRefreshBody
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.includes('/twofactorauth/')) {
            return Promise.resolve(
              jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
            )
          }
          if (headers.Authorization !== undefined) {
            return Promise.resolve(
              jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-a'] })
            )
          }
          if (href.endsWith('/auth/user')) return Promise.resolve(refreshResponse)
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission())

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      binding.failNextSave()
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(refreshBodyStarted).toBe(true))
      const status = adapter.getAuthStatus()
      let statusSettled = false
      void status.then(() => {
        statusSettled = true
      })
      await new Promise((resolve) => setImmediate(resolve))

      expect(statusSettled).toBe(false)

      releaseRefreshBody({ id: 'ACCOUNT001', displayName: 'Account A' })
      await expect(verify).resolves.toMatchObject({
        ok: false,
        error: 'credential_persistence_failed'
      })
      await expect(status).resolves.toMatchObject({ state: 'unauthenticated' })
    })

    it('keeps a subscribed pipeline stopped when completed 2FA cannot persist', async () => {
      let directLoginCalls = 0
      const sockets: DrivableVrcSocket[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.endsWith('/auth')) {
            return Promise.resolve(jsonResponse({ token: 'pipeline-token' }))
          }
          if (href.includes('/twofactorauth/')) {
            return Promise.resolve(
              jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
            )
          }
          if (headers.Authorization !== undefined) {
            directLoginCalls += 1
            return Promise.resolve(
              directLoginCalls === 1
                ? jsonResponse(
                    { id: 'ACCOUNT001', displayName: 'Account A' },
                    { setCookies: ['auth=account-a'] }
                  )
                : jsonResponse(
                    { requiresTwoFactorAuth: ['totp'] },
                    { setCookies: ['auth=account-b'] }
                  )
            )
          }
          if (href.endsWith('/auth/user')) {
            return Promise.resolve(jsonResponse({ id: 'ACCOUNT002', displayName: 'Account B' }))
          }
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })

      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      const unsubscribe = adapter.subscribe(() => {})
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )

      await expect(adapter.login(creds)).resolves.toEqual({
        ok: false,
        needs2fa: true,
        method: 'totp'
      })
      binding.failNextSave()
      const result = await adapter.verify2fa('123456')
      const replacementPipelineCount = createPipeline.mock.calls.length
      const socketCount = sockets.length
      const oldSocketClosed = sockets[0]!.closed
      unsubscribe()

      expect(result).toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect(replacementPipelineCount).toBe(0)
      expect(socketCount).toBe(1)
      expect(oldSocketClosed).toBe(true)
    })

    it('makes a later direct login supersede a held 2FA verify without crossing ownership', async () => {
      let releaseVerifyBody!: (body: unknown) => void
      let verifyBodyStarted = false
      const heldVerifyBody = new Promise<unknown>((resolve) => {
        releaseVerifyBody = resolve
      })
      const verifyResponse = jsonResponse(null, { setCookies: ['twoFactorAuth=account-a-2fa'] })
      vi.spyOn(verifyResponse, 'json').mockImplementation(() => {
        verifyBodyStarted = true
        return heldVerifyBody
      })
      let directLoginCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.includes('/twofactorauth/')) return Promise.resolve(verifyResponse)
          if (headers.Authorization !== undefined) {
            directLoginCalls += 1
            return Promise.resolve(
              directLoginCalls === 1
                ? jsonResponse(
                    { requiresTwoFactorAuth: ['totp'] },
                    { setCookies: ['auth=account-a'] }
                  )
                : jsonResponse(
                    { id: 'ACCOUNT002', displayName: 'Account B' },
                    { setCookies: ['auth=account-b'] }
                  )
            )
          }
          if (href.endsWith('/auth/user')) {
            return Promise.resolve(jsonResponse({ id: 'ACCOUNT001', displayName: 'Account A' }))
          }
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(verifyBodyStarted).toBe(true))
      const accountBLogin = adapter.login({ username: 'account-b', password: 'pw-b' })
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      releaseVerifyBody({ verified: true })

      await expect(Promise.all([verify, accountBLogin])).resolves.toEqual([
        { ok: false, needs2fa: false, error: 'unexpected_response' },
        { ok: true }
      ])
      expect(binding.getCredential()).toBe('auth=account-b')
      expect(binding.getAttemptedAccountIds()).toEqual(['ACCOUNT002'])
      expect(binding.getOwner()).toBe('ACCOUNT002')
      expect(identities.at(-1)).toBe('ACCOUNT002')
    })

    it('defers a new subscriber during completed-2FA refresh when persistence fails', async () => {
      let releaseRefreshBody!: (body: unknown) => void
      let refreshBodyStarted = false
      const heldRefreshBody = new Promise<unknown>((resolve) => {
        releaseRefreshBody = resolve
      })
      const refreshResponse = jsonResponse(null)
      vi.spyOn(refreshResponse, 'json').mockImplementation(() => {
        refreshBodyStarted = true
        return heldRefreshBody
      })
      const sockets: DrivableVrcSocket[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const headers = (options?.headers ?? {}) as Record<string, string>
          if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tentative' }))
          if (href.includes('/twofactorauth/')) {
            return Promise.resolve(
              jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
            )
          }
          if (headers.Authorization !== undefined) {
            return Promise.resolve(
              jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=account-a'] })
            )
          }
          if (href.endsWith('/auth/user')) return Promise.resolve(refreshResponse)
          return Promise.reject(new Error(`Unexpected URL: ${href}`))
        })
      )
      const binding = ownerBindingHarness<string>()
      const adapter = new VrcAdapter(binding.store, instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        }
      })

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      binding.failNextSave()
      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )
      const verify = adapter.verify2fa('123456')
      await vi.waitFor(() => expect(refreshBodyStarted).toBe(true))
      const unsubscribe = adapter.subscribe(() => {})
      releaseRefreshBody({ id: 'ACCOUNT001', displayName: 'Account A' })
      const result = await verify
      const pipelineCount = createPipeline.mock.calls.length
      const socketCount = sockets.length
      unsubscribe()

      expect(result).toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect(pipelineCount).toBe(0)
      expect(socketCount).toBe(0)
    })

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
        .mockResolvedValueOnce(jsonResponse({ id: 'TRINITY09', displayName: 'Trinity' }))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, instantAdmission())

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
          return Promise.resolve(jsonResponse({ id: 'ACCOUNTA1', displayName: 'Account A' }))
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
      const identities: Array<string | null> = []
      const adapter = new VrcAdapter(fakeStore('auth=account-a'), instantAdmission(), {
        socketFactory: () => {
          const socket = new DrivableVrcSocket()
          sockets.push(socket)
          return socket
        },
        onSessionBoundary: () => engine.resetPlatform('vrchat'),
        onIdentity: (accountId) => identities.push(accountId)
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
      expect(identities.at(-1)).toBeNull()
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

      expect(await adapter.verify2fa('123456')).toEqual({
        ok: false,
        needs2fa: false,
        error: AUTH_IDENTITY_UNAVAILABLE,
        sessionCleared: true
      })
      expect((adapter as unknown as { displayName: string | null }).displayName).toBeNull()
      expect(identities.slice(-2)).toEqual([null, null])
      unsubscribe()
    })

    it('routes emailOtp to /emailotp/verify (never /otp/verify — that is the recovery endpoint)', async () => {
      // VRX-229: the API contract, not our implementation, is the truth here —
      // otp/verify only accepts RECOVERY codes, so an email code posted there
      // is always rejected. The exact-path assertions below are the pin.
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
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      expect(await adapter.login(creds)).toEqual({ ok: false, needs2fa: true, method: 'email' })
      await adapter.login({ ...creds, twoFactorCode: '000000' })

      const verifyUrl = (fetchMock.mock.calls[1] as [string, RequestInit])[0]
      expect(verifyUrl).toMatch(/\/auth\/twofactorauth\/emailotp\/verify$/)
      expect(verifyUrl).not.toMatch(/\/auth\/twofactorauth\/otp\/verify$/)
    })

    it('the production email flow — login → needs2fa → verify2fa — routes to /emailotp/verify', async () => {
      // The renderer never calls login() with an inline code; LoginScreen and
      // AccountCard both go login → needs2fa → verify2fa. Pin the endpoint on
      // THAT sequence for email too (Opus verifier catch, VRX-229 — the
      // routing test above drives an entry point the renderer doesn't use).
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
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      expect(await adapter.login(creds)).toEqual({ ok: false, needs2fa: true, method: 'email' })
      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })

      const verifyUrl = (fetchMock.mock.calls[1] as [string, RequestInit])[0]
      expect(verifyUrl).toMatch(/\/auth\/twofactorauth\/emailotp\/verify$/)
    })

    it('reports a rejected 2FA code', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'bad code' }, { status: 400 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      await adapter.login(creds)
      expect(await adapter.login({ ...creds, twoFactorCode: 'wrong' })).toEqual({
        ok: false,
        needs2fa: false,
        error: 'invalid_2fa_code'
      })
    })

    it('says a sign-in was rate limited after one request, without resending the password', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      await expect(adapter.login(creds)).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'rate_limited'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('says a 2FA code was rate limited after one request and keeps waiting for a code', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      await expect(adapter.verify2fa('123456')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'rate_limited'
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
    })

    it('blames the service, not the code, when 2FA verify gets a server error', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, { status: 503 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      await adapter.login(creds)
      await expect(adapter.verify2fa('123456')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'http_503'
      })
    })

    it('keeps a failed direct-login 2FA session tentative so a subscriber cannot start its pipeline', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=partial'] })
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'bad code' }, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(fakeStore(), instantAdmission())

      await expect(adapter.login(creds)).resolves.toMatchObject({ needs2fa: true })
      await expect(adapter.verify2fa('wrong')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'invalid_2fa_code'
      })

      const createPipeline = vi.spyOn(
        adapter as unknown as { createPipeline: () => object },
        'createPipeline'
      )
      const unsubscribe = adapter.subscribe(() => {})
      expect(createPipeline).not.toHaveBeenCalled()
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'needs-2fa' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      unsubscribe()
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
        const adapter = new VrcAdapter(store, instantAdmission())

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
      const adapter = new VrcAdapter(store, instantAdmission())

      await adapter.login(creds)
      await adapter.login({ ...creds, twoFactorCode: '123456' })

      expect(store.saved.at(-1)).toBe('auth=rotated9; twoFactorAuth=tf2')
    })

    it('rejects a non-printable cookie issued by the 2FA response', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ requiresTwoFactorAuth: ['totp'] }, { setCookies: ['auth=tok1'] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=tf2\tpoison'] })
        )
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new VrcAdapter(store, instantAdmission())

      await adapter.login(creds)
      await expect(adapter.verify2fa('123456')).resolves.toEqual({
        ok: false,
        needs2fa: false,
        error: 'invalid_credentials'
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(store.saved).toEqual([])
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
      const adapter = new VrcAdapter(store, instantAdmission())

      expect(await adapter.login(creds)).toEqual({ ok: false, needs2fa: true, method: 'totp' })
      expect(await adapter.verify2fa('123456')).toEqual({ ok: true })

      const [verifyUrl, verifyOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(verifyUrl).toMatch(/\/auth\/twofactorauth\/totp\/verify$/)
      expect(verifyOpts.body).toBe(JSON.stringify({ code: '123456' }))
      expect(store.saved.at(-1)).toBe('auth=tok1; twoFactorAuth=tf2')
    })
  })
})
