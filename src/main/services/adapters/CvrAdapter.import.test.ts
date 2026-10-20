/**
 * "Use my sign-in from this PC" for ChilloutVR (owner, 2026-10-20). An access
 * key read from the game or CVRX is validated by ACCESS_KEY auth and bound to
 * its owner before it is persisted; a failed import changes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_PERSISTENCE_FAILED,
  SESSION_IMPORT_NOT_FOUND,
  SESSION_IMPORT_REJECTED
} from '@shared/types'
import type { CVRCredentials } from './CvrApiClient'
import { CvrAdapter } from './CvrAdapter'
import { instantAdmission, jsonResponse, ownerBindingHarness } from './__testutils__/adapterTestKit'

const OWNER = 'a1b2c3d4-0000-0000-0000-000000000001'
const OTHER = 'a1b2c3d4-0000-0000-0000-000000000002'

function authEnvelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    message: 'ok',
    data: {
      username: 'trinity',
      accessKey: 'rotated-key',
      userId: OWNER,
      currentAvatar: 'avatar-guid',
      currentHomeWorld: 'world-guid',
      videoUrlResolverExecutable: '',
      videoUrlResolverHashes: '',
      blockedUsers: [],
      ...overrides
    }
  }
}

const imported: CVRCredentials = { username: 'trinity', accessKey: 'imported-key' }

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  return JSON.parse(init.body as string) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CvrAdapter.importSession', () => {
  it('signs in by access key, binds the owner, and persists the key CVR returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(authEnvelope()))
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<CVRCredentials>()
    const identities: Array<string | null> = []
    const adapter = new CvrAdapter(binding.store, instantAdmission(), {
      onIdentity: (id) => identities.push(id)
    })

    await expect(adapter.importSession(imported)).resolves.toEqual({ ok: true })

    expect(requestBody(fetchMock)).toMatchObject({
      AuthType: 1,
      Username: 'trinity',
      Password: 'imported-key'
    })
    expect(binding.getCredential()).toEqual({ username: 'trinity', accessKey: 'rotated-key' })
    expect(binding.getOwner()).toBe(OWNER)
    expect(identities.at(-1)).toBe(OWNER)
    // Proven by the import itself: no second auth call on the next status read.
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({
      state: 'authenticated',
      accountId: OWNER
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed material before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<CVRCredentials>()
    const adapter = new CvrAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession({ username: '', accessKey: 'k' })).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: SESSION_IMPORT_NOT_FOUND
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(binding.getAttemptedAccountIds()).toEqual([])
  })

  it.each([
    ['a dead key (401)', () => jsonResponse({ message: 'nope' }, 401), SESSION_IMPORT_REJECTED],
    [
      'a forbidden key (403)',
      () => jsonResponse({ message: 'nope' }, 403),
      SESSION_IMPORT_REJECTED
    ],
    ['a server error', () => jsonResponse({ message: 'down' }, 503), 'http_503'],
    ['an unreadable body', () => new Response('not json', { status: 200 }), 'bad_response'],
    ['schema drift', () => jsonResponse({ message: 'ok', data: {} }), 'unexpected_response']
  ])('keeps the current session untouched after %s', async (_label, reply, error) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authEnvelope({ accessKey: 'current-key' })))
      .mockImplementationOnce(() => Promise.resolve(reply()))
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<CVRCredentials>()
    const adapter = new CvrAdapter(binding.store, instantAdmission())
    await adapter.login({ username: 'trinity@example.com', password: 'whiterabbit' })

    await expect(adapter.importSession(imported)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error
    })

    expect(binding.getCredential()).toEqual({ username: 'trinity', accessKey: 'current-key' })
    expect(binding.getOwner()).toBe(OWNER)
    expect(binding.getAttemptedAccountIds()).toHaveLength(1)
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
  })

  it('reports a network failure without saving anything', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const binding = ownerBindingHarness<CVRCredentials>()
    const adapter = new CvrAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(imported)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: 'network_error'
    })
    expect(binding.getAttemptedAccountIds()).toEqual([])
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
  })

  it('discards the session when it cannot be saved securely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authEnvelope())))
    const binding = ownerBindingHarness<CVRCredentials>()
    binding.failNextSave()
    const adapter = new CvrAdapter(binding.store, instantAdmission())

    await expect(adapter.importSession(imported)).resolves.toEqual({
      ok: false,
      needs2fa: false,
      error: CREDENTIAL_PERSISTENCE_FAILED,
      sessionCleared: true
    })
    expect(binding.getOwner()).toBeNull()
    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
  })

  it('loses to a newer password login that starts while it is in flight', async () => {
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
        jsonResponse(authEnvelope({ username: 'morpheus', accessKey: 'login-key', userId: OTHER }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const binding = ownerBindingHarness<CVRCredentials>()
    const adapter = new CvrAdapter(binding.store, instantAdmission())

    const pendingImport = adapter.importSession(imported)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await expect(
      adapter.login({ username: 'morpheus@example.com', password: 'bluepill' })
    ).resolves.toEqual({ ok: true })
    releaseImport(jsonResponse(authEnvelope()))

    await expect(pendingImport).resolves.toMatchObject({ ok: false })
    expect(binding.getCredential()).toEqual({ username: 'morpheus', accessKey: 'login-key' })
    expect(binding.getOwner()).toBe(OTHER)
  })
})
