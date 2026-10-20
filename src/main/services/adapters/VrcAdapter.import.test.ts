/**
 * "Use my sign-in from this PC" for VRChat (owner, 2026-10-20). A cookie read
 * from VRCX is checked against /auth/user before it replaces anything; only a
 * live cookie with a named owner is persisted, and an expired second factor
 * becomes the ordinary code prompt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_PERSISTENCE_FAILED,
  SESSION_IMPORT_NOT_FOUND,
  SESSION_IMPORT_REJECTED
} from '@shared/types'
import { VrcAdapter } from './VrcAdapter'
import { instantAdmission, jsonResponse, ownerBindingHarness } from './__testutils__/adapterTestKit'

const IMPORTED = 'auth=authcookie_vrcx; twoFactorAuth=twofactor_vrcx'
const IMPORTED_ID = 'usr_0b2f3c4d-1111-4222-8333-444455556666'
const CURRENT_ID = 'usr_0b2f3c4d-1111-4222-8333-777788889999'
const LOGIN_ID = 'usr_0b2f3c4d-1111-4222-8333-aaaabbbbcccc'
const ME = { id: IMPORTED_ID, displayName: 'Nova' }

function cookieSent(fetchMock: ReturnType<typeof vi.fn>, call = 0): string | undefined {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  return (init.headers as Record<string, string>).Cookie
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VrcAdapter.importSession', () => {
  it('checks the VRCX cookie with VRChat, then binds its owner and persists it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ME))
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<string>()
    const identities: Array<string | null> = []
    const adapter = new VrcAdapter(binding.store, instantAdmission(), {
      onIdentity: (id) => identities.push(id)
    })

    await expect(adapter.importSession(IMPORTED)).resolves.toEqual({ ok: true })

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/auth\/user$/)
    expect(cookieSent(fetchMock)).toBe(IMPORTED)
    expect(binding.getCredential()).toBe(IMPORTED)
    expect(binding.getOwner()).toBe(IMPORTED_ID)
    expect(identities.at(-1)).toBe(IMPORTED_ID)
    expect(adapter.getAuthCookieHeader()).toBe(IMPORTED)
  })

  it.each([
    ['missing auth part', 'twoFactorAuth=only'],
    ['a foreign cookie', 'session=abc'],
    ['non-printable bytes', 'auth=bad\u0001value']
  ])('rejects %s before any request', async (_label, cookie) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<string>()
    const adapter = new VrcAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(cookie)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: SESSION_IMPORT_NOT_FOUND
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a dead cookie (401)', () => jsonResponse({ error: 'nope' }, 401), SESSION_IMPORT_REJECTED],
    ['a server error', () => jsonResponse({ error: 'down' }, 502), 'http_502'],
    ['an unreadable body', () => new Response('not json', { status: 200 }), 'bad_response'],
    ['schema drift', () => jsonResponse({ unexpected: true }), 'unexpected_response']
  ])('leaves the current session untouched after %s', async (_label, reply, error) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: CURRENT_ID, displayName: 'Current' }))
      .mockImplementationOnce(() => Promise.resolve(reply()))
      .mockResolvedValue(jsonResponse({ id: CURRENT_ID, displayName: 'Current' }))
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<string>('auth=current')
    const adapter = new VrcAdapter(binding.store, instantAdmission())
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })

    await expect(adapter.importSession(IMPORTED)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error
    })

    expect(binding.getCredential()).toBe('auth=current')
    expect(binding.getOwner()).toBe(CURRENT_ID)
    expect(adapter.getAuthCookieHeader()).toBe('auth=current')
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({
      state: 'authenticated',
      accountId: CURRENT_ID
    })
  })

  it('reports a network failure without installing the cookie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const binding = ownerBindingHarness<string>()
    const adapter = new VrcAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(IMPORTED)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: 'network_error'
    })
    expect(binding.getAttemptedAccountIds()).toEqual([])
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
  })

  it('turns an expired second factor into the code prompt, then verifies against the imported cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requiresTwoFactorAuth: ['emailOtp'] }))
      .mockResolvedValueOnce(
        jsonResponse({ verified: true }, { setCookies: ['twoFactorAuth=fresh'] })
      )
      .mockResolvedValueOnce(jsonResponse(ME))
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<string>('auth=previous')
    const adapter = new VrcAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(IMPORTED)).resolves.toEqual({
      ok: false,
      needs2fa: true,
      method: 'email'
    })
    // The previous account cannot come back if VRX quits mid-prompt, and the
    // tentative cookie is not usable by any consumer yet.
    expect(binding.getCredential()).toBeUndefined()
    expect(adapter.getAuthCookieHeader()).toBeNull()
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({
      state: 'needs-2fa',
      twoFactorMethod: 'email'
    })

    await expect(adapter.verify2fa('123456')).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/emailotp\/verify$/)
    expect(cookieSent(fetchMock, 1)).toBe(IMPORTED)
    expect(binding.getCredential()).toBe('auth=authcookie_vrcx; twoFactorAuth=fresh')
    expect(binding.getOwner()).toBe(IMPORTED_ID)
  })

  it('discards the session when it cannot be saved securely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ME)))
    const binding = ownerBindingHarness<string>()
    binding.failNextSave()
    const adapter = new VrcAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(IMPORTED)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: CREDENTIAL_PERSISTENCE_FAILED,
      sessionCleared: true
    })
    expect(binding.getOwner()).toBeNull()
    expect(adapter.getAuthCookieHeader()).toBeNull()
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
  })

  it('is superseded by a password login started while it is in flight', async () => {
    let releaseImport!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseImport = resolve
          })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: LOGIN_ID, displayName: 'Login' }, { setCookies: ['auth=login_cookie'] })
      )
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<string>()
    const adapter = new VrcAdapter(binding.store, instantAdmission())

    const pendingImport = adapter.importSession(IMPORTED)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const login = adapter.login({ username: 'neo', password: 'redpill' })
    releaseImport(jsonResponse(ME))

    await expect(pendingImport).resolves.toMatchObject({ ok: false })
    await expect(login).resolves.toEqual({ ok: true })
    expect(binding.getCredential()).toBe('auth=login_cookie')
    expect(binding.getOwner()).toBe(LOGIN_ID)
  })
})
