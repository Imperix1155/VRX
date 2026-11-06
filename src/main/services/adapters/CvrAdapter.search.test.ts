import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'

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

describe('CvrAdapter search', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends the typed text as one search path step', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'ok', data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.search('neko/cafe ...', adapter.captureCommunityLease())).resolves.toEqual(
      { people: [], worlds: [] }
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.abinteractive.net/1/search/neko%2Fcafe%20...'
    )
  })

  it.each(['.', '..'])('finds nothing for “%s” without a request', async (query) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'ok', data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.search(query, adapter.captureCommunityLease())).resolves.toEqual({
      people: [],
      worlds: []
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
