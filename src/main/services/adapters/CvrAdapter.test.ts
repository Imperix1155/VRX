import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, InstanceInfo } from '@shared/types'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { jsonResponse, noopSleep, ownerBindingHarness } from './__testutils__/adapterTestKit'
import { FriendAlerts, type FriendAlert } from '../friendAlerts'
import { AccountSession } from '../accountSession'

/** In-memory credential store recording persisted sessions + delete calls. */
function fakeStore(
  initial?: CVRCredentials
): CvrCredentialStore & { saved: CVRCredentials[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as CVRCredentials[],
    deleted: 0,
    load: () => value,
    save: (credentials: CVRCredentials, accountId: string | null) => {
      void accountId
      value = credentials
      store.saved.push(credentials)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

/** A full CVR auth payload (the schema requires every field). */
function authPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    username: 'trinity',
    accessKey: 'key-1',
    userId: 'a1b2c3d4-0000-0000-0000-000000000001',
    currentAvatar: 'avatar-guid',
    currentHomeWorld: 'world-guid',
    videoUrlResolverExecutable: '',
    videoUrlResolverHashes: '',
    blockedUsers: [],
    ...overrides
  }
}

function envelope(data: Record<string, unknown>): { message: string; data: unknown } {
  return { message: 'ok', data }
}

const creds = { username: 'trinity@example.com', password: 'whiterabbit' }

describe('CvrAdapter', () => {
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
        onIdentity: (accountId) => accountSession.setIdentity('chilloutvr', accountId),
        onSessionBoundary: () => {
          expect(accountSession.getAccountId('chilloutvr')).toBeNull()
          boundary()
        }
      }
    }

    it('clears AccountSession before restored-session adoption', () => {
      const accountSession = new AccountSession()
      accountSession.setIdentity('chilloutvr', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      const boundary = vi.fn()

      new CvrAdapter(fakeStore({ username: 'restored', accessKey: 'key-a' }), noopSleep, {
        onIdentity: (accountId) => accountSession.setIdentity('chilloutvr', accountId),
        onSessionBoundary: () => {
          expect(accountSession.getAccountId('chilloutvr')).toBeNull()
          boundary()
        }
      })

      expect(boundary).toHaveBeenCalledTimes(1)
    })

    it('clears AccountSession before fresh-login adoption', async () => {
      const accountSession = new AccountSession()
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
      const boundary = vi.fn()
      const adapter = new CvrAdapter(fakeStore(), noopSleep, wiring(accountSession, boundary))

      await adapter.login(creds)
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      expect(accountSession.getAccountId('chilloutvr')).toBe('a1b2c3d4-0000-0000-0000-000000000002')
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before access-key rotation adoption', async () => {
      const accountSession = new AccountSession()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload({ accessKey: 'rotated-key' }))))
      )
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'old-key' }),
        noopSleep,
        wiring(accountSession, boundary)
      )
      accountSession.setIdentity('chilloutvr', authPayload().userId as string)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before non-emitting invalidation', async () => {
      const accountSession = new AccountSession()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'dead-key' }),
        noopSleep,
        wiring(accountSession, boundary)
      )
      accountSession.setIdentity('chilloutvr', authPayload().userId as string)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before emitting invalidation', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(envelope(authPayload())))
        .mockResolvedValueOnce(jsonResponse({ message: 'denied' }, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new CvrAdapter(fakeStore(), noopSleep, wiring(accountSession, boundary))

      await adapter.login(creds)
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(accountSession.getAccountId('chilloutvr')).toBeNull()
      expect(boundary).toHaveBeenCalledTimes(2)
    })
  })

  describe('login (password leg — raw, breaker-free)', () => {
    it('binds the owner on first login into an empty credential slot', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const binding = ownerBindingHarness<CVRCredentials>()
      const adapter = new CvrAdapter(binding.store, noopSleep)

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
      const adapter = new CvrAdapter(binding.store, noopSleep)

      await adapter.login(creds)
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000002')
    })

    it('fails closed when credential writing throws after owner clearing', async () => {
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
      const adapter = new CvrAdapter(binding.store, noopSleep)

      await adapter.login(creds)
      binding.failNextSave()
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      expect(binding.getCredential()).toEqual({ username: 'trinity', accessKey: 'key-1' })
      expect(binding.getOwner()).toBeNull()
      expect(binding.getAttemptedAccountIds().at(-1)).toBe('a1b2c3d4-0000-0000-0000-000000000002')
    })

    it('authenticates, persists ONLY username+accessKey, reports authenticated status', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(store, noopSleep, {
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
      const adapter = new CvrAdapter(fakeStore(), noopSleep, {
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
      const adapter = new CvrAdapter(fakeStore(), noopSleep)

      expect(await adapter.login(creds)).toEqual({ ok: true })
      // Navigating away and back re-checks status many times; every check must
      // stay authenticated and NONE may hit the wire (the reported v0.4.0 bug).
      for (let i = 0; i < 5; i++) {
        expect((await adapter.getAuthStatus()).state).toBe('authenticated')
      }
      expect(fetchMock).toHaveBeenCalledTimes(1) // still just the one login call
    })

    it('login punches through an OPEN circuit breaker — "cannot connect" bug (VRX-190)', async () => {
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep)
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
      const adapter = new CvrAdapter(store, noopSleep)

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
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'http_503'
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline')))
      )
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'network_error'
      })
    })

    it('malformed envelope → unexpected_response (never a false success)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'ok', data: { nope: true } })))
      )
      const store = fakeStore()
      const adapter = new CvrAdapter(store, noopSleep)
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

        expect(await new CvrAdapter(store, noopSleep).login(creds)).toEqual({
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
      const adapter = new CvrAdapter(fakeStore(), noopSleep)

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
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
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

  describe('session restore + validation (VRX-174)', () => {
    it('backfills the owner for the restored credential after validation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const restored = { username: 'trinity', accessKey: 'key-1' }
      const binding = ownerBindingHarness(restored)
      const adapter = new CvrAdapter(binding.store, noopSleep)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })

      expect(binding.getCredential()).toEqual(restored)
      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    })

    it('restores a persisted session and validates it via ACCESS_KEY reauth', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, noopSleep)

      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'authenticated',
        displayName: 'trinity',
        accountId: 'a1b2c3d4-0000-0000-0000-000000000001'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('persists a ROTATED accessKey returned by reauth', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key-2' })))))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(store, noopSleep, {
        onIdentity: (accountId) => identities.push(accountId)
      })

      await adapter.getAuthStatus()
      expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-2' }])
      expect(identities).toEqual([null, null, 'a1b2c3d4-0000-0000-0000-000000000001'])
    })

    it('a rejected accessKey (401) clears the persisted session — no zombie restore', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'dead-key' })
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(store, noopSleep, {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'unauthenticated',
        displayName: null,
        accountId: null
      })
      expect(store.deleted).toBe(1)
      expect(identities.at(-1)).toBeNull()
      // A second probe must NOT re-send the dead key.
      const second = await adapter.getAuthStatus()
      expect(second.state).toBe('unauthenticated')
    })

    it('network trouble reports error WITHOUT clearing the session', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline')))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, noopSleep)

      const status = await adapter.getAuthStatus()
      expect(status.state).toBe('error')
      expect(store.deleted).toBe(0)
      expect(store.load()).toEqual({ username: 'trinity', accessKey: 'key-1' })
    })

    it('no persisted session → unauthenticated without touching the network', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
      expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a throwing store is tolerated at construction and at persist time', async () => {
      const throwingStore: CvrCredentialStore = {
        load: () => {
          throw new Error('locked')
        },
        save: () => {
          throw new Error('locked')
        },
        delete: () => {
          throw new Error('locked')
        }
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      )
      const adapter = new CvrAdapter(throwingStore, noopSleep)
      // Login succeeds in-memory even when persistence is unavailable.
      expect(await adapter.login(creds)).toEqual({ ok: true })
      expect((await adapter.getAuthStatus()).state).toBe('authenticated')
    })

    it('keeps automatic 401 deletion best-effort when the credential store is unavailable', async () => {
      const store: CvrCredentialStore = {
        load: () => ({ username: 'trinity', accessKey: 'expired' }),
        save: () => {},
        delete: () => {
          throw new Error('safeStorage unavailable')
        }
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      const adapter = new CvrAdapter(store, noopSleep)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
    })

    it('propagates explicit logout deletion failure without clearing the live session', async () => {
      const store: CvrCredentialStore = {
        load: () => ({ username: 'trinity', accessKey: 'key-1' }),
        save: () => {},
        delete: () => {
          throw new Error('credential deletion failed')
        }
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const adapter = new CvrAdapter(store, noopSleep)

      expect(() => adapter.clearSession()).toThrow('credential deletion failed')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'a1b2c3d4-0000-0000-0000-000000000001',
        displayName: 'trinity'
      })
    })
  })

  describe('contract surface', () => {
    it('importSession is false, join URLs are pure, and self-invite stays unsupported', async () => {
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
      expect(await adapter.importSession()).toBe(false)
      expect(
        adapter.buildJoinUrl(
          { instanceId: 'i+bab275f822c020a0-152002-e81321-1fe976f9' } as InstanceInfo,
          'vr'
        )
      ).toBe(
        'chilloutvr://instance/join?instanceId=i%2Bbab275f822c020a0-152002-e81321-1fe976f9&startInVR=true'
      )
      await expect(adapter.selfInvite()).rejects.toThrow('not supported')
    })
  })

  describe('getFriends (VRX-57 delegation, VRX-58 stitch)', () => {
    const sessioned = (): CvrAdapter =>
      new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep)

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
      const friends = await sessioned().getFriends()
      expect(friends).toHaveLength(2)
      expect(friends[0]).toMatchObject({ platform: 'chilloutvr', displayName: 'Neo' })
      expect(friends[0]?.presence.state).toBe('offline')
      // GUID normalized to lowercase (VRX-61) — stable across name changes.
      expect(friends[0]?.platformUserId).toBe('a1b2c3d4-0000-0000-0000-000000000001')
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

    it('retries an account-A roster success after account B is adopted', async () => {
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
        noopSleep
      )

      const staleRoster = adapter.getFriends()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })

      releaseAccountARoster(
        jsonResponse({
          message: 'ok',
          data: [{ id: accountAId, name: 'Account A Friend', imageUrl: null, categories: [] }]
        })
      )
      await expect(staleRoster).resolves.toEqual([
        expect.objectContaining({
          platformUserId: accountBId,
          displayName: 'Account B Friend'
        })
      ])
      expect(adapter.resolveFriendName(accountAId)).toBeNull()
      expect(adapter.resolveFriendName(accountBId)).toBe('Account B Friend')
      expect(friendsCalls).toBe(2)
    })

    it('ignores a stale account-A 401 and retries without clearing account B', async () => {
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
      const adapter = new CvrAdapter(store, noopSleep)

      const roster = adapter.getFriends()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(await adapter.login(creds)).toEqual({ ok: true })
      releaseAccountARoster(jsonResponse({ message: 'denied' }, { status: 401 }))

      await expect(roster).resolves.toEqual([
        expect.objectContaining({ platformUserId: accountBId, displayName: 'Account B Friend' })
      ])
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
        noopSleep,
        { socketFactory: () => ({ on: () => {}, close: () => {} }) }
      )
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

      const first = adapter.getFriends()
      await vi.waitFor(() => expect(calls).toBe(1))
      await adapter.getFriends()
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

      const first = adapter.getFriends()
      await vi.waitFor(() => expect(calls).toBe(1))
      await expect(adapter.getFriends()).rejects.toThrow()

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
      const adapter = new CvrAdapter(store, noopSleep)
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
      const adapter = new CvrAdapter(store, noopSleep)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'oops' }, { status: 500 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(store.deleted).toBe(0) // a 5xx blip must not log the user out
    })

    it('a 401 on getFriends EMITS auth-invalidated so the renderer re-checks auth (VRX-195)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      adapter.subscribe((e) => events.push(e))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
    })

    it('a 5xx on getFriends does NOT emit auth-invalidated (the session is still valid)', async () => {
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
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
    it('subscribe starts ONE shared pipeline and stops it when the last handler leaves', async () => {
      let dials = 0
      const fakeSocket = { on: () => {}, close: () => {} }
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => {
          dials++
          return fakeSocket
        }
      })

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
      const adapter = new CvrAdapter(fakeStore(), noopSleep, {
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
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep)
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

  describe('instance enrichment (VRX-59)', () => {
    // Minimal drivable socket (CvrPipeline.test pattern).
    type Listener = (...args: unknown[]) => void
    function drivableSocket(): {
      socket: { on: (e: string, l: Listener) => void; close: () => void; send: () => void }
      fire: (event: string, ...args: unknown[]) => void
    } {
      const listeners = new Map<string, Listener[]>()
      return {
        socket: {
          on: (event: string, listener: Listener) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener])
          },
          close: () => {},
          send: () => {}
        },
        fire: (event: string, ...args: unknown[]) => {
          for (const l of listeners.get(event) ?? []) l(...args)
        }
      }
    }

    // Instance tag via interpolation (design-token raw-color guard).
    const taggedName = `SunDown (#${816332})`
    const instanceDetail = {
      id: 'i_abc',
      name: taggedName,
      world: { id: 'wrld-real', name: 'SunDown', imageUrl: 'https://img.example/w.png' },
      currentPlayerCount: 5,
      instanceSettingPrivacy: 2 // friends (live-confirmed numeric)
    }

    it('re-emits an enriched presence-snapshot once the instance resolves (world id + clean name)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(instanceDetail))))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => rig.socket
      })
      const snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>> = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      )

      // Immediate snapshot carries the WIRE values (worldId = instance id;
      // worldName = the creator-set label, the UI's fallback until resolution —
      // FriendAlerts independently strips it from alert copy).
      expect(snapshots[0]!.entries[0]!.instance).toMatchObject({
        worldId: 'i_abc',
        worldName: taggedName
      })

      // The resolution lands → a re-emitted snapshot carries the TRUE world.
      await vi.waitFor(() => {
        const last = snapshots.at(-1)!
        expect(last.entries[0]!.instance).toMatchObject({
          worldId: 'wrld-real',
          worldName: 'SunDown',
          thumbnailUrl: 'https://img.example/w.png',
          userCount: 5
        })
      })
      // instanceId and WS-fresh privacy classification are untouched.
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        instanceId: 'i_abc',
        type: 'public'
      })
      unsub()
    })

    it('rapid snapshots while a resolution is in flight produce ONE re-emit, not N (Sol High)', async () => {
      let releaseResolution!: (r: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          return href.endsWith('/friends')
            ? Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
            : held
        })
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => rig.socket
      })
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      const wsFrame = (): string =>
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      // THREE rapid snapshots while the same instance resolution is held open.
      rig.fire('message', wsFrame())
      rig.fire('message', wsFrame())
      rig.fire('message', wsFrame())
      expect(snapshots).toHaveLength(3) // pass-through emits, one per frame

      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await vi.waitFor(() => {
        const last = snapshots.at(-1)! as Extract<AdapterEvent, { type: 'presence-snapshot' }>
        expect(last.entries[0]!.instance?.worldId).toBe('wrld-real')
      })
      // Exactly ONE enrichment re-emit (4 total) — not one per queued snapshot.
      await new Promise((r) => setTimeout(r, 20))
      expect(snapshots).toHaveLength(4)
      unsub()
    })

    it('cannot re-emit an old snapshot between reconnect live and the fresh baseline', async () => {
      let releaseResolution!: (response: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => held)
      )
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      const alerts: FriendAlert[] = []
      const friendAlerts = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Known Friend'
      })
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((event) => {
        friendAlerts.consume(event)
        if (event.type === 'presence-snapshot') snapshots.push(event)
      })
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      const oldSnapshot: AdapterEvent = {
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_old',
              instanceId: 'i_old',
              worldName: taggedName,
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              region: null,
              userCount: null
            }
          }
        ]
      }

      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'live'
      })
      drive.handlePipelineEvent(oldSnapshot)
      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'reconnecting'
      })
      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'live'
      })

      // The old lookup settles inside the vulnerable live→new-snapshot gap.
      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await new Promise((resolve) => setImmediate(resolve))
      expect(snapshots).toHaveLength(1)

      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000002',
            presence: { state: 'in-game' },
            instance: null
          }
        ]
      })
      expect(snapshots).toHaveLength(2)
      expect(alerts).toEqual([])
      unsub()
    })

    it('resolution failure leaves wire values standing (no re-emit, no throw)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'nope' }, { status: 404 })))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => rig.socket
      })
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_dead', Name: 'Hidden', Privacy: 7 }
            }
          ]
        })
      )
      // Give the (failing) resolution time to settle; still exactly ONE snapshot.
      await new Promise((r) => setTimeout(r, 20))
      expect(snapshots).toHaveLength(1)
      // Wire label stays as the UI fallback when resolution fails (VRX-59 UX).
      expect(
        (snapshots[0] as Extract<AdapterEvent, { type: 'presence-snapshot' }>).entries[0]!.instance
          ?.worldName
      ).toBe('Hidden')
      unsub()
    })

    it('fires an unresolved in-game alert without the creator-set instance label', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'not found' }, { status: 404 })))
      )
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      const alerts: FriendAlert[] = []
      const engine = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Known Friend'
      })
      const unsub = adapter.subscribe((event) => engine.consume(event))
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: null
          }
        ]
      })
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'offline' },
            instance: null
          }
        ]
      })
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_unresolved',
              instanceId: 'i_unresolved',
              worldName: "Bono's Movie Night",
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              region: null,
              userCount: null
            }
          }
        ]
      })

      expect(alerts).toContainEqual(expect.objectContaining({ type: 'in-game', worldName: null }))
      unsub()
    })

    it('a late resolution cannot re-emit the pre-quarantine roster after auth dies (VRX-195 guard)', async () => {
      // fetch: the instance resolution is HELD until after the 401 clears the
      // session — then released. No re-emit may follow.
      let releaseResolution!: (r: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (u.includes('/instances/')) return held
          // getFriends path → 401 (kills the session, VRX-195)
          return Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))
        })
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep, {
        socketFactory: () => rig.socket
      })
      const events: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => events.push(e))
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      )
      const snapshotsBefore = events.filter((e) => e.type === 'presence-snapshot').length
      expect(snapshotsBefore).toBe(1)

      // The session dies on the data path (401 → clearSession + auth-invalidated).
      await expect(adapter.getFriends()).rejects.toThrow()
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(true)

      // NOW the held resolution lands — it must not resurrect the old roster.
      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await new Promise((r) => setTimeout(r, 20))
      const snapshotsAfter = events.filter((e) => e.type === 'presence-snapshot').length
      expect(snapshotsAfter).toBe(snapshotsBefore) // no post-quarantine re-emit
      unsub()
    })

    it('adoptSession A→B drops a late A resolution and a late A socket event everywhere', async () => {
      let releaseAccountAResolution!: (response: Response) => void
      const heldResolution = new Promise<Response>((resolve) => {
        releaseAccountAResolution = resolve
      })
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/friends')) {
          return Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
        }
        if (href.includes('/instances/')) return heldResolution
        return Promise.resolve(
          jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
        )
      })
      vi.stubGlobal('fetch', fetchMock)

      const rigs = [drivableSocket(), drivableSocket()]
      let dial = 0
      const alerts: FriendAlert[] = []
      const friendAlerts = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Account A Friend'
      })
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        noopSleep,
        {
          socketFactory: () => rigs[dial++]!.socket,
          onSessionBoundary: () => friendAlerts.resetPlatform('chilloutvr')
        }
      )
      const unsub = adapter.subscribe((event) => {
        events.push(event)
        friendAlerts.consume(event)
      })
      await vi.waitFor(() => expect(dial).toBe(1))
      rigs[0]!.fire('open')
      rigs[0]!.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_account_a', Name: 'Account A World', Privacy: 0 }
            }
          ]
        })
      )
      await vi.waitFor(() => {
        const requestedAccountAInstance = fetchMock.mock.calls.some(([url]) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          return href.includes('/instances/i_account_a')
        })
        expect(requestedAccountAInstance).toBe(true)
      })

      events.length = 0
      expect(await adapter.login(creds)).toEqual({ ok: true })
      await vi.waitFor(() => expect(dial).toBe(2))

      releaseAccountAResolution(jsonResponse(envelope(instanceDetail)))
      rigs[0]!.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: null
            }
          ]
        })
      )
      await new Promise((resolve) => setImmediate(resolve))

      expect(events.filter((event) => event.type === 'presence-snapshot')).toEqual([])
      expect(alerts).toEqual([])
      const engineState = friendAlerts as unknown as {
        presence: Map<string, Map<string, unknown>>
      }
      expect(engineState.presence.get('chilloutvr')?.size ?? 0).toBe(0)
      const resolver = (
        adapter as unknown as {
          instanceResolver: { peek: (id: string) => unknown }
        }
      ).instanceResolver
      expect(resolver.peek('i_account_a')).toBeUndefined()
      unsub()
    })

    it('getInstanceDetails maps the resolved detail to a full InstanceInfo', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(instanceDetail))))
      )
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep)
      const info = await adapter.getInstanceDetails('i_abc')
      expect(info).toEqual({
        worldId: 'wrld-real',
        instanceId: 'i_abc',
        worldName: 'SunDown',
        thumbnailUrl: 'https://img.example/w.png',
        type: 'friends', // privacy 2 via parseCvrPrivacy
        openness: 'friends',
        isGroup: false,
        groupName: null,
        region: null,
        userCount: 5
      })
    })

    it('retries instance resolution after a session swap instead of returning account-A data', async () => {
      let releaseAccountA!: (response: Response) => void
      const heldAccountA = new Promise<Response>((resolve) => {
        releaseAccountA = resolve
      })
      let instanceCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (href.includes('/instances/')) {
            instanceCalls += 1
            if (instanceCalls === 1) return heldAccountA
            return Promise.resolve(
              jsonResponse(
                envelope({
                  ...instanceDetail,
                  world: { id: 'world-b', name: 'Account B World', imageUrl: null }
                })
              )
            )
          }
          return Promise.resolve(
            jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
          )
        })
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        noopSleep
      )

      const details = adapter.getInstanceDetails('i_abc')
      await vi.waitFor(() => expect(instanceCalls).toBe(1))
      expect(await adapter.login(creds)).toEqual({ ok: true })
      releaseAccountA(jsonResponse(envelope(instanceDetail)))

      await expect(details).resolves.toMatchObject({
        worldId: 'world-b',
        worldName: 'Account B World'
      })
      expect(instanceCalls).toBe(2)
    })

    it('getInstanceDetails rejects (does not return null) when unresolvable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'gone' }, { status: 404 })))
      )
      const adapter = new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), noopSleep)
      await expect(adapter.getInstanceDetails('i_gone')).rejects.toThrow(
        'private or could not be resolved'
      )
    })
  })
})

describe('CvrAdapter concurrent validation (verifier race)', () => {
  it('two overlapping getAuthStatus calls share ONE reauth — no stale-key second call', async () => {
    let resolveFetch: ((r: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
    const adapter = new CvrAdapter(store, noopSleep)

    const first = adapter.getAuthStatus()
    const second = adapter.getAuthStatus()
    // Both share ONE in-flight validation → exactly one underlying reauth fetch
    // (waitFor is timing-robust; the point is the count never reaches 2).
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    resolveFetch?.(jsonResponse(envelope(authPayload({ accessKey: 'key-2' }))))
    const [a, b] = await Promise.all([first, second])
    expect(a.state).toBe('authenticated')
    expect(b.state).toBe('authenticated')
    // The rotation persisted exactly once and nothing cleared it.
    expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-2' }])
    expect(store.deleted).toBe(0)

    // A LATER call (after settle) makes a fresh validation.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key-2' })))))
    )
    expect((await adapter.getAuthStatus()).state).toBe('authenticated')
  })
})

describe('CvrAdapter validation failures do not poison login (Codex, 2026-07-06)', () => {
  // The circuit breaker is shared across the adapter; before the fix, guarded
  // session validation recorded non-2xx/schema failures against it, so automatic
  // background refetches could open the breaker (threshold 3) and fast-fail a
  // CORRECT-password login as network_error. Validation is now breaker-free.
  it('repeated 5xx session validations never block a subsequent correct login', async () => {
    const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
    const adapter = new CvrAdapter(store, noopSleep)

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ message: 'oops' }, { status: 500 })))
    )
    for (let i = 0; i < 4; i++) {
      expect((await adapter.getAuthStatus()).state).toBe('error')
    }
    expect(store.deleted).toBe(0) // a 5xx is transient — never clears the session

    // Correct password must reach the wire, not fast-fail on a poisoned breaker.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
    )
    expect(await adapter.login(creds)).toEqual({ ok: true })
  })

  it('repeated network validation failures do not block a subsequent correct login', async () => {
    const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
    const adapter = new CvrAdapter(store, noopSleep)

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    )
    for (let i = 0; i < 3; i++) {
      expect((await adapter.getAuthStatus()).state).toBe('error')
    }

    const loginFetch = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
    vi.stubGlobal('fetch', loginFetch)

    expect(await adapter.login(creds)).toEqual({ ok: true })
    expect(loginFetch).toHaveBeenCalledTimes(1)
  })

  it('schema-drifted validation reports error without clearing or poisoning login', async () => {
    const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
    const adapter = new CvrAdapter(store, noopSleep)

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ message: 'ok', data: { nope: true } })))
    )
    for (let i = 0; i < 4; i++) {
      expect((await adapter.getAuthStatus()).state).toBe('error')
    }
    expect(store.deleted).toBe(0) // drift is not a dead session

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
    )
    expect(await adapter.login(creds)).toEqual({ ok: true })
  })

  it('a login() landing mid-validation is NOT clobbered by the stale reauth (verifier finding)', async () => {
    const store = fakeStore({ username: 'A', accessKey: 'ka' })
    const adapter = new CvrAdapter(store, noopSleep)

    // AuthType 1 = validation of the OLD session A (held pending); AuthType 2 =
    // the fresh login to session B (resolves immediately).
    let resolveValidation!: (r: Response) => void
    const fetchMock = vi.fn((_url: string, opts: RequestInit) => {
      const parsed = JSON.parse(opts.body as string) as { AuthType: number }
      if (parsed.AuthType === 1) {
        return new Promise<Response>((res) => {
          resolveValidation = res
        })
      }
      return Promise.resolve(
        jsonResponse(envelope(authPayload({ username: 'B', accessKey: 'kb' })))
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const validating = adapter.getAuthStatus() // validateSession(A) → pending
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(await adapter.login({ username: 'B@x', password: 'pw' })).toEqual({ ok: true })

    // The STALE validation of A now returns 401 — it must NOT wipe session B.
    resolveValidation(jsonResponse({ message: 'denied' }, { status: 401 }))
    expect((await validating).state).toBe('authenticated')
    expect(store.deleted).toBe(0) // B survived
    expect(store.saved.at(-1)).toEqual({ username: 'B', accessKey: 'kb' })
  })
})
