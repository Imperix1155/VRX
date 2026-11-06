import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { HomeWorldIdError } from './HomeWorldAdapter'
import { CVRRateLimitError } from './errors'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const WORLD = 'c4a1d0f2-6b8e-4c1d-9a7e-2f3b4c5d6e7f'

function store(): CvrCredentialStore {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  return { load: () => credentials, save: () => {}, delete: () => {} }
}

function signedIn(): CvrAdapter {
  const adapter = new CvrAdapter(store(), instantAdmission())
  Object.assign(
    adapter as unknown as { validated: boolean; accountId: string; displayName: string },
    { validated: true, accountId: ME, displayName: 'Guide visitor' }
  )
  return adapter
}

describe('CvrAdapter home world', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends one GET to the sethome route and never retries it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Home world set', data: null }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await adapter.setHomeWorld(WORLD, adapter.captureHomeWorldLease())
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.abinteractive.net/1/worlds/${WORLD}/sethome`)
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(options.headers).toMatchObject({ Username: 'cvr-user', AccessKey: 'cvr-access-key' })

    await expect(
      adapter.setHomeWorld(WORLD, adapter.captureHomeWorldLease())
    ).rejects.toBeInstanceOf(CVRRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a malformed world ID before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    for (const bad of [`${WORLD}/../avatars`, `wrld_${WORLD}`, '']) {
      await expect(
        adapter.setHomeWorld(bad, adapter.captureHomeWorldLease())
      ).rejects.toBeInstanceOf(HomeWorldIdError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
