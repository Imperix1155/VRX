import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { HomeWorldIdError } from './HomeWorldAdapter'
import { AuthError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const USER = 'usr_12345678-1234-1234-1234-123456789abc'
const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function signedIn(): VrcAdapter {
  const adapter = new VrcAdapter(store(), instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: USER })
  return adapter
}

describe('VrcAdapter home world', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends one PUT of homeLocation to the signed-in user and never retries it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: USER }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await adapter.setHomeWorld(WORLD, adapter.captureHomeWorldLease())
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.vrchat.cloud/api/1/users/${USER}`)
    expect(options).toMatchObject({ method: 'PUT', redirect: 'error' })
    expect(options.headers).toMatchObject({
      Cookie: 'auth=synthetic',
      'Content-Type': 'application/json'
    })
    expect(JSON.parse(String(options.body))).toEqual({ homeLocation: WORLD })

    await expect(
      adapter.setHomeWorld(WORLD, adapter.captureHomeWorldLease())
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a malformed world ID before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    for (const bad of ['wrld_x/../../auth', USER, '']) {
      await expect(
        adapter.setHomeWorld(bad, adapter.captureHomeWorldLease())
      ).rejects.toBeInstanceOf(HomeWorldIdError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a 401 invalidates the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = signedIn()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(
      adapter.setHomeWorld(WORLD, adapter.captureHomeWorldLease())
    ).rejects.toBeInstanceOf(AuthError)
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    const adapter = new VrcAdapter(store(), instantAdmission())
    expect(() => adapter.captureHomeWorldLease()).toThrow()
  })
})
