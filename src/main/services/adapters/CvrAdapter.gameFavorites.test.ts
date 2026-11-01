import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { GameFavoritesDataError } from './GameFavoritesAdapter'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const FRIEND = '7b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b'
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

const worldGroups = [
  { key: 'worlds_a', name: 'Hangouts', capacity: null },
  { key: 'worlds_b', name: 'Clubs', capacity: null }
]

describe('CvrAdapter game favorites', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reads the user's own categories and their worlds the way CVRX does", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          message: null,
          data: {
            friends: [
              { id: 'frndonline', name: 'Online Friends' },
              { id: 'friends_best', name: 'Best' }
            ],
            worlds: [
              { id: 'wrldactive', name: 'Active' },
              { id: 'worlds_a', name: 'Hangouts' }
            ]
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          message: null,
          data: { totalPages: 1, entries: [{ id: WORLD, name: 'Moon', imageUrl: null }] }
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const read = await adapter.readGameFavorites(adapter.captureFavoritesLease())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.abinteractive.net/1/categories',
      'https://api.chilloutvr.net/2/worlds/list/worlds_a?page=0&sort=Default&direction=Ascending'
    ])
    expect(read.oneGroupPerItem).toBe(false)
    expect(read.groups.friend).toEqual([{ key: 'friends_best', name: 'Best', capacity: null }])
    expect(read.groups.world).toEqual([{ key: 'worlds_a', name: 'Hangouts', capacity: null }])
    expect(read.worlds.get(WORLD)).toEqual([{ key: 'worlds_a', entryId: null }])
  })

  it('reads the categories right before one assign that keeps the others', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          message: null,
          data: { id: WORLD, name: 'Moon', categories: ['wrldmine', 'worlds_a', 'worlds_z'] }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'Categories updated', data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const after = await adapter.writeGameFavorite(
      {
        kind: 'world',
        id: WORLD,
        group: worldGroups[1]!,
        on: true,
        current: [{ key: 'worlds_a', entryId: null }],
        groups: worldGroups
      },
      adapter.captureFavoritesLease()
    )
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.chilloutvr.net/1/worlds/${WORLD}`)
    const [url, options] = fetchMock.mock.calls[1]!
    expect(url).toBe('https://api.abinteractive.net/1/categories/assign')
    expect(options.method).toBe('POST')
    // A category VRX does not list (worlds_z) stays; built-in ones are never sent.
    expect(JSON.parse(String(options.body))).toEqual({
      Uuid: WORLD,
      CategoryType: 'Worlds',
      Categories: ['worlds_a', 'worlds_z', 'worlds_b']
    })
    expect(after).toEqual([
      { key: 'worlds_a', entryId: null },
      { key: 'worlds_b', entryId: null }
    ])
  })

  it('refuses to write when the read does not say which categories it has', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: null, data: { id: FRIEND, name: 'Sam' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(
      adapter.writeGameFavorite(
        {
          kind: 'friend',
          id: FRIEND,
          group: { key: 'friends_best', name: 'Best', capacity: null },
          on: true,
          current: [],
          groups: [{ key: 'friends_best', name: 'Best', capacity: null }]
        },
        adapter.captureFavoritesLease()
      )
    ).rejects.toBeInstanceOf(GameFavoritesDataError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.abinteractive.net/1/users/${FRIEND}`)
  })

  it('refuses a built-in category or a bad id before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    for (const [id, key] of [
      [WORLD, 'wrldactive'],
      [`${WORLD}/../x`, 'worlds_a'],
      [WORLD, 'friends_best']
    ] as const) {
      await expect(
        adapter.writeGameFavorite(
          {
            kind: 'world',
            id,
            group: { key, name: 'x', capacity: null },
            on: true,
            current: [],
            groups: worldGroups
          },
          adapter.captureFavoritesLease()
        )
      ).rejects.toBeInstanceOf(GameFavoritesDataError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
