import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { GameFavoritesDataError } from './GameFavoritesAdapter'
import { RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const ME = 'usr_12345678-1234-1234-1234-123456789abc'
const FRIEND = 'usr_aaaaaaaa-1234-1234-1234-123456789abc'
const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'
const ENTRY = 'fvrt_11111111-2222-3333-4444-555555555555'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function signedIn(): VrcAdapter {
  const adapter = new VrcAdapter(store(), instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: ME })
  return adapter
}

const groupsFriend = [
  { key: 'friend:group_0', name: 'Besties', capacity: 150 },
  { key: 'friend:group_1', name: 'Group 2', capacity: 150 }
]

describe('VrcAdapter game favorites', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the limits, the groups and the favorites the way VRCX does', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          maxFavoriteGroups: { friend: 3, world: 4, avatar: 6 },
          maxFavoritesPerGroup: { friend: 150, world: 100, avatar: 50 }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 'fvgrp_1', type: 'friend', name: 'group_0', displayName: 'Besties' },
          { id: 'fvgrp_2', type: 'world', name: 'worlds1', displayName: 'Chill' }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: ENTRY, type: 'friend', favoriteId: FRIEND, tags: ['group_0'] }])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: WORLD,
            name: 'Sky',
            thumbnailImageUrl: 'https://api.vrchat.cloud/api/1/image/file_x/1/256',
            occupants: 3,
            favoriteGroup: 'worlds1',
            favoriteId: ENTRY
          }
        ])
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const read = await adapter.readGameFavorites(adapter.captureFavoritesLease())

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/auth/user/favoritelimits',
      'https://api.vrchat.cloud/api/1/favorite/groups?n=50&offset=0',
      'https://api.vrchat.cloud/api/1/favorites?type=friend&n=100&offset=0',
      'https://api.vrchat.cloud/api/1/worlds/favorites?n=100&offset=0'
    ])
    for (const [, options] of fetchMock.mock.calls) expect(options.method).toBe('GET')
    expect(read.oneGroupPerItem).toBe(true)
    expect(read.groups.friend.map((g) => g.name)).toEqual(['Besties', 'Group 2', 'Group 3'])
    expect(read.groups.world.map((g) => g.key)).toEqual([
      'world:worlds1',
      'world:worlds2',
      'world:worlds3',
      'world:worlds4'
    ])
    expect(read.friends.get(FRIEND)).toEqual([{ key: 'friend:group_0', entryId: ENTRY }])
    expect(read.worlds.get(WORLD)).toEqual([{ key: 'world:worlds1', entryId: ENTRY }])
    expect(read.worldEvidence.map((w) => w.worldId)).toEqual([WORLD])
  })

  it('adds with one POST of type, id and group, and never resends it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: ENTRY, type: 'friend', favoriteId: FRIEND, tags: ['group_1'] })
      )
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const change = {
      kind: 'friend' as const,
      id: FRIEND,
      group: groupsFriend[1]!,
      on: true,
      current: [],
      groups: groupsFriend
    }
    const after = await adapter.writeGameFavorite(change, adapter.captureFavoritesLease())
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.vrchat.cloud/api/1/favorites')
    expect(options.method).toBe('POST')
    expect(JSON.parse(String(options.body))).toEqual({
      type: 'friend',
      favoriteId: FRIEND,
      tags: ['group_1']
    })
    expect(after).toEqual([{ key: 'friend:group_1', entryId: ENTRY }])

    await expect(
      adapter.writeGameFavorite(change, adapter.captureFavoritesLease())
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('removes with one DELETE of the favorite record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: { message: 'ok' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const after = await adapter.writeGameFavorite(
      {
        kind: 'friend',
        id: FRIEND,
        group: groupsFriend[0]!,
        on: false,
        current: [{ key: 'friend:group_0', entryId: ENTRY }],
        groups: groupsFriend
      },
      adapter.captureFavoritesLease()
    )
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.vrchat.cloud/api/1/favorites/${ENTRY}`)
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE')
    expect(after).toEqual([])
  })

  it('refuses a bad id or a group of the wrong kind before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const base = { on: true, current: [], groups: groupsFriend }
    for (const change of [
      { ...base, kind: 'friend' as const, id: 'usr_x/../auth', group: groupsFriend[0]! },
      { ...base, kind: 'world' as const, id: WORLD, group: groupsFriend[0]! },
      {
        ...base,
        kind: 'friend' as const,
        id: FRIEND,
        group: { key: 'friend:../x', name: 'x', capacity: 1 }
      }
    ]) {
      await expect(
        adapter.writeGameFavorite(change, adapter.captureFavoritesLease())
      ).rejects.toBeInstanceOf(GameFavoritesDataError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
