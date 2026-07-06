import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'

/** In-memory credential store recording persisted sessions + delete calls. */
function fakeStore(
  initial?: CVRCredentials
): CvrCredentialStore & { saved: CVRCredentials[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as CVRCredentials[],
    deleted: 0,
    load: () => value,
    save: (credentials: CVRCredentials) => {
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

  describe('login (password leg — raw, breaker-free)', () => {
    it('authenticates, persists ONLY username+accessKey, reports authenticated status', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore()
      const adapter = new CvrAdapter(store, noopSleep)

      const result = await adapter.login(creds)

      expect(result).toEqual({ ok: true })
      expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-1' }])
      // The password must appear nowhere in the persisted session.
      expect(JSON.stringify(store.saved)).not.toContain(creds.password)
      // Status probe reauthenticates with the ACCESS_KEY method (AuthType 1).
      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'authenticated',
        displayName: 'trinity'
      })
      const lastCall = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
      const lastBody = JSON.parse(lastCall[1].body as string) as Record<string, unknown>
      expect(lastBody.AuthType).toBe(1)
      expect(lastBody.Username).toBe('trinity')
      expect(lastBody.Password).toBe('key-1')
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
    it('restores a persisted session and validates it via ACCESS_KEY reauth', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, noopSleep)

      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'authenticated',
        displayName: 'trinity'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('persists a ROTATED accessKey returned by reauth', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key-2' })))))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, noopSleep)

      await adapter.getAuthStatus()
      expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-2' }])
    })

    it('a rejected accessKey (401) clears the persisted session — no zombie restore', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'dead-key' })
      const adapter = new CvrAdapter(store, noopSleep)

      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'unauthenticated',
        displayName: null
      })
      expect(store.deleted).toBe(1)
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
  })

  describe('contract surface', () => {
    it('importSession is false (CVRX import = VRX-56); data methods reject with their issue', async () => {
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
      expect(await adapter.importSession()).toBe(false)
      await expect(adapter.getFriends()).rejects.toThrow('VRX-57')
      await expect(adapter.getInstanceDetails()).rejects.toThrow('VRX-59')
      await expect(adapter.joinInstance()).rejects.toThrow('VRX-60')
      await expect(adapter.selfInvite()).rejects.toThrow('not supported')
    })

    it('subscribe is a safe no-op until VRX-58 (returns a working unsubscribe)', () => {
      const adapter = new CvrAdapter(fakeStore(), noopSleep)
      const unsubscribe = adapter.subscribe()
      expect(() => unsubscribe()).not.toThrow()
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
})
