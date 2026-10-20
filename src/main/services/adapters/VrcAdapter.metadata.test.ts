import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORLD_CACHE_TTL_MS } from '@shared/constants'
import type { VrcCredentialStore, VrcMetadataPersistence } from './VrcAdapter'
import { VRC_METADATA_SAVE_DELAY_MS, VrcAdapter } from './VrcAdapter'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const WORLD_ID = 'wrld_00000000-0000-0000-0000-000000000001'
const THE_GRID = {
  name: 'The Grid',
  thumbnailUrl: 'https://api.vrchat.cloud/api/1/image/file_grid/1/256',
  capacity: 32,
  shortName: null
}

function credentialStore(): VrcCredentialStore {
  let value: string | undefined = 'auth=synthetic'
  return {
    load: () => value,
    save: (cookie) => {
      value = cookie
    },
    delete: () => {
      value = undefined
    }
  }
}

function rosterFetch(world: () => Response): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.includes('/auth/user/friends')) {
      const online = !url.includes('offline=true')
      return Promise.resolve(
        jsonResponse(
          online && url.includes('offset=0')
            ? [
                {
                  id: 'usr_111',
                  displayName: 'Bob',
                  currentAvatarThumbnailImageUrl: null,
                  status: 'active',
                  statusDescription: null,
                  tags: [],
                  location: `${WORLD_ID}:11111`
                }
              ]
            : []
        )
      )
    }
    if (url.includes(`/worlds/${WORLD_ID}`)) return Promise.resolve(world())
    return Promise.resolve(
      jsonResponse({
        id: 'SELF0001',
        displayName: 'Self',
        onlineFriends: ['usr_111'],
        activeFriends: [],
        offlineFriends: []
      })
    )
  })
}

function worldRequests(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes('/worlds/')).length
}

function adapterWith(store: VrcMetadataPersistence): VrcAdapter {
  return new VrcAdapter(credentialStore(), instantAdmission(), {
    socketFactory: () => ({ on: () => {}, close: () => {} }),
    metadataStore: store
  })
}

describe('VrcAdapter stored world names', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('enriches the first roster from stored names without asking VRChat', async () => {
    const fetchMock = rosterFetch(() => jsonResponse({ name: 'Fetched' }))
    vi.stubGlobal('fetch', fetchMock)
    const load = vi.fn(() => ({
      worlds: [{ id: WORLD_ID, meta: THE_GRID, expiresAt: Date.now() + WORLD_CACHE_TTL_MS / 2 }],
      groups: []
    }))
    const adapter = adapterWith({ load, save: vi.fn() })

    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ accountId: 'SELF0001' })
    expect(load).toHaveBeenCalledWith('SELF0001')
    const { friends } = await adapter.getFriends()

    expect(friends[0]?.instance?.worldName).toBe('The Grid')
    expect(worldRequests(fetchMock)).toBe(0)
    // Later status refreshes in the same session do not re-read the store.
    await adapter.getAuthStatus()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('saves a new lookup for its account once the burst settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetchMock = rosterFetch(() =>
      jsonResponse({ name: 'The Grid', thumbnailImageUrl: THE_GRID.thumbnailUrl, capacity: 32 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const save = vi.fn()
    const adapter = adapterWith({ load: () => null, save })

    await adapter.getAuthStatus()
    await adapter.getFriends()
    await vi.waitFor(() => expect(worldRequests(fetchMock)).toBe(1))
    await vi.advanceTimersByTimeAsync(VRC_METADATA_SAVE_DELAY_MS - 1)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('SELF0001', {
      worlds: [{ id: WORLD_ID, meta: THE_GRID, expiresAt: expect.any(Number) }],
      groups: []
    })
  })

  it('drops a pending save when the session ends first', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetchMock = rosterFetch(() => jsonResponse({ name: 'The Grid' }))
    vi.stubGlobal('fetch', fetchMock)
    const save = vi.fn()
    const adapter = adapterWith({ load: () => null, save })

    await adapter.getAuthStatus()
    await adapter.getFriends()
    await vi.waitFor(() => expect(worldRequests(fetchMock)).toBe(1))
    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(VRC_METADATA_SAVE_DELAY_MS * 2)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps working when the store cannot be read', async () => {
    const fetchMock = rosterFetch(() => jsonResponse({ name: 'Fetched' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = adapterWith({
      load: () => {
        throw new Error('disk gone')
      },
      save: vi.fn()
    })

    await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
    await adapter.getFriends()
    await vi.waitFor(() => expect(worldRequests(fetchMock)).toBe(1))
  })
})
