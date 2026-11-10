import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { AuthSessionPendingError, CVRAuthError } from './errors'
import { jsonResponse, instantAdmission, ownerBindingHarness } from './__testutils__/adapterTestKit'
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

  describe('session restore + validation (VRX-174)', () => {
    it('does not adopt or send a persisted session containing non-printable bytes', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key\npoison' }),
        instantAdmission()
      )

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('quarantines a restored session from the friends REST consumer', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key-1' }),
        instantAdmission()
      )

      await expect(adapter.getFriends()).rejects.toBeInstanceOf(AuthSessionPendingError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('quarantines a restored session from the instance REST consumer', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key-1' }),
        instantAdmission()
      )

      await expect(adapter.getInstanceDetails('i_pending')).rejects.toBeInstanceOf(
        AuthSessionPendingError
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('backfills the owner for the restored credential after validation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const restored = { username: 'trinity', accessKey: 'key-1' }
      const binding = ownerBindingHarness(restored)
      const adapter = new CvrAdapter(binding.store, instantAdmission())

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })

      expect(binding.getCredential()).toEqual(restored)
      expect(binding.getOwner()).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    })

    it('fails closed when an unchanged restored session cannot persist its owner binding', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload()))))
      const saveCredential = vi.fn(() => {
        throw new Error('credential write failed')
      })
      const deleteCredential = vi.fn()
      const identities: Array<string | null> = []
      const store: CvrCredentialStore = {
        load: () => ({ username: 'trinity', accessKey: 'key-1' }),
        save: saveCredential,
        delete: deleteCredential
      }
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      const restartPipeline = vi.spyOn(
        adapter as unknown as { restartPipeline: () => void },
        'restartPipeline'
      )

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })

      expect(saveCredential).toHaveBeenCalledOnce()
      expect(deleteCredential).toHaveBeenCalledOnce()
      expect(identities).not.toContain('a1b2c3d4-0000-0000-0000-000000000001')
      expect(restartPipeline).not.toHaveBeenCalled()
    })

    it('clears a restored session when rotated credentials cannot persist', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload({ accessKey: 'rotated-key' }))))
      )
      const identities: Array<string | null> = []
      const deleteCredential = vi.fn(() => {
        throw new Error('credential deletion failed')
      })
      const store: CvrCredentialStore = {
        load: () => ({ username: 'trinity', accessKey: 'old-key' }),
        save: () => {
          throw new Error('credential write failed')
        },
        delete: deleteCredential
      }
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })
      const restartPipeline = vi.spyOn(
        adapter as unknown as { restartPipeline: () => void },
        'restartPipeline'
      )

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })

      expect(deleteCredential).toHaveBeenCalledOnce()
      expect(identities).not.toContain('a1b2c3d4-0000-0000-0000-000000000001')
      expect(restartPipeline).not.toHaveBeenCalled()
    })

    it('restores a persisted session and validates it via ACCESS_KEY reauth', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      vi.stubGlobal('fetch', fetchMock)
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, instantAdmission())

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
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      await adapter.getAuthStatus()
      expect(store.saved).toEqual([{ username: 'trinity', accessKey: 'key-2' }])
      expect(identities).toEqual([null, null, 'a1b2c3d4-0000-0000-0000-000000000001'])
    })

    it('rejects and clears a non-printable session returned by reauth', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(jsonResponse(envelope(authPayload({ accessKey: 'key\npoison' }))))
        )
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, instantAdmission())

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(store.saved).toEqual([])
      expect(store.deleted).toBe(1)
    })

    it('a rejected accessKey (401) clears the persisted session — no zombie restore', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'dead-key' })
      const identities: Array<string | null> = []
      const adapter = new CvrAdapter(store, instantAdmission(), {
        onIdentity: (accountId) => identities.push(accountId)
      })

      const status = await adapter.getAuthStatus()
      expect(status).toEqual({
        platform: 'chilloutvr',
        state: 'unauthenticated',
        displayName: null,
        accountId: null,
        endedByPlatform: true
      })
      expect(store.deleted).toBe(1)
      expect(identities.at(-1)).toBeNull()
      // A second probe must NOT re-send the dead key.
      const second = await adapter.getAuthStatus()
      expect(second.state).toBe('unauthenticated')
    })

    it('says ChilloutVR ended the session until the user signs out', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'dead-key' }),
        instantAdmission()
      )

      expect(await adapter.getAuthStatus()).toMatchObject({
        state: 'unauthenticated',
        endedByPlatform: true
      })
      // A sign-out the user chose never reads as ChilloutVR's doing.
      adapter.clearSession()
      expect(await adapter.getAuthStatus()).not.toHaveProperty('endedByPlatform')
    })

    it('forgets that ChilloutVR ended the session once the user signs in again', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'dead-key' }),
        instantAdmission()
      )
      expect(await adapter.getAuthStatus()).toMatchObject({ endedByPlatform: true })

      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(envelope(authPayload()))))
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      const status = await adapter.getAuthStatus()
      expect(status.state).toBe('authenticated')
      expect(status).not.toHaveProperty('endedByPlatform')
    })

    it('network trouble reports error WITHOUT clearing the session', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline')))
      )
      const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
      const adapter = new CvrAdapter(store, instantAdmission())

      const status = await adapter.getAuthStatus()
      expect(status.state).toBe('error')
      expect(store.deleted).toBe(0)
      expect(store.load()).toEqual({ username: 'trinity', accessKey: 'key-1' })
    })

    it('no persisted session → unauthenticated without touching the network', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new CvrAdapter(fakeStore(), instantAdmission())
      expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a throwing store is tolerated at construction and fails login closed', async () => {
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
      const adapter = new CvrAdapter(throwingStore, instantAdmission())
      expect(await adapter.login(creds)).toEqual({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      })
      expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
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
      const adapter = new CvrAdapter(store, instantAdmission())

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
    })

    it('records an explicit logout as a sign-out but a dead key as a plain delete', async () => {
      const calls: string[] = []
      const store: CvrCredentialStore = {
        load: () => ({ username: 'trinity', accessKey: 'key-1' }),
        save: () => {},
        delete: () => calls.push('delete'),
        signOut: () => calls.push('signOut')
      }
      const adapter = markSessionEstablishedForTest(new CvrAdapter(store, instantAdmission()))
      adapter.clearSession()
      expect(calls).toEqual(['signOut'])

      calls.length = 0
      const restored = markSessionEstablishedForTest(new CvrAdapter(store, instantAdmission()))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      await expect(restored.getFriends()).rejects.toBeInstanceOf(CVRAuthError)
      expect(calls).toEqual(['delete'])
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
      const adapter = new CvrAdapter(store, instantAdmission())

      expect(() => adapter.clearSession()).toThrow('credential deletion failed')
      await expect(adapter.getAuthStatus()).resolves.toMatchObject({
        state: 'authenticated',
        accountId: 'a1b2c3d4-0000-0000-0000-000000000001',
        displayName: 'trinity'
      })
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
    const adapter = new CvrAdapter(store, instantAdmission())

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
    const adapter = new CvrAdapter(store, instantAdmission())

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
    const adapter = new CvrAdapter(store, instantAdmission())

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

  it('marks only a validation that got no answer as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    )
    expect(
      await new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key-1' }),
        instantAdmission()
      ).getAuthStatus()
    ).toMatchObject({ state: 'error', unreachable: true })

    // ChilloutVR answered and refused: never re-checked from the tray.
    for (const status of [500, 429]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'no' }, { status })))
      )
      const result = await new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'key-1' }),
        instantAdmission()
      ).getAuthStatus()
      expect(result.state).toBe('error')
      expect(result.unreachable).toBeUndefined()
    }
  })

  it('schema-drifted validation reports error without clearing or poisoning login', async () => {
    const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
    const adapter = new CvrAdapter(store, instantAdmission())

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
    const adapter = new CvrAdapter(store, instantAdmission())

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

  it('lets a held direct login finish after automatic invalidation clears the restored session', async () => {
    const store = fakeStore({ username: 'A', accessKey: 'ka' })
    const identities: Array<string | null> = []
    const adapter = new CvrAdapter(store, instantAdmission(), {
      onIdentity: (accountId) => identities.push(accountId)
    })
    let releaseValidation!: (response: Response) => void
    let releaseLogin!: (response: Response) => void
    let validationStarted = false
    let loginStarted = false
    const heldValidation = new Promise<Response>((resolve) => {
      releaseValidation = resolve
    })
    const heldLogin = new Promise<Response>((resolve) => {
      releaseLogin = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string) as { AuthType: number }
        if (body.AuthType === 1) {
          validationStarted = true
          return heldValidation
        }
        loginStarted = true
        return heldLogin
      })
    )

    const status = adapter.getAuthStatus()
    await vi.waitFor(() => expect(validationStarted).toBe(true))
    const login = adapter.login({ username: 'B@x', password: 'pw' })
    await vi.waitFor(() => expect(loginStarted).toBe(true))

    releaseValidation(jsonResponse({ message: 'denied' }, { status: 401 }))
    await expect(status).resolves.toMatchObject({ state: 'unauthenticated' })
    releaseLogin(
      jsonResponse(
        envelope(
          authPayload({
            username: 'B',
            accessKey: 'kb',
            userId: 'a1b2c3d4-0000-0000-0000-000000000002'
          })
        )
      )
    )

    await expect(login).resolves.toEqual({ ok: true })
    expect(store.deleted).toBe(1)
    expect(store.saved.at(-1)).toEqual({ username: 'B', accessKey: 'kb' })
    expect(identities.at(-1)).toBe('a1b2c3d4-0000-0000-0000-000000000002')
  })
})
