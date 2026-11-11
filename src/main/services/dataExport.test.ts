import { describe, expect, it } from 'vitest'
import type { LinkedProfile } from '@shared/linkedProfiles'
import type { Platform } from '@shared/types'
import {
  buildDataExport,
  dataExportFileName,
  serializeDataExport,
  type DataExportSources,
  type ExportFavoriteGroups
} from './dataExport'

const VRC_ME = 'usr_me'
const CVR_ME = 'cvr-me'

interface World {
  accounts: Record<Platform, string | null>
  rosters: Record<Platform, { id: string; name: string }[] | null>
  stars: Record<Platform, string[]>
  worlds: Record<Platform, { worldId: string; name: string }[]>
  notes: Record<Platform, Record<string, string>>
  game: Record<Platform, ExportFavoriteGroups | 'off' | 'unavailable'>
  links: LinkedProfile[]
  noteReads: Array<[Platform, string]>
}

function world(overrides: Partial<World> = {}): World {
  return {
    accounts: { vrchat: VRC_ME, chilloutvr: CVR_ME },
    rosters: {
      vrchat: [
        { id: 'usr_b', name: 'Bea' },
        { id: 'usr_a', name: 'Ari' }
      ],
      chilloutvr: [{ id: 'cvr-c', name: 'Cy' }]
    },
    stars: { vrchat: ['usr_a'], chilloutvr: [] },
    worlds: { vrchat: [{ worldId: 'wrld_1', name: 'Sky' }], chilloutvr: [] },
    notes: { vrchat: { usr_b: 'met at the meetup' }, chilloutvr: { 'cvr-c': 'plays piano' } },
    game: { vrchat: 'off', chilloutvr: 'off' },
    links: [],
    noteReads: [],
    ...overrides
  }
}

function sources(w: World): DataExportSources {
  return {
    accountId: (platform) => w.accounts[platform],
    roster: (platform) => w.rosters[platform],
    favoriteFriendIds: (platform) => w.stars[platform],
    favoriteWorlds: (platform) => w.worlds[platform],
    notes: (platform, accountId) => {
      w.noteReads.push([platform, accountId])
      return w.notes[platform]
    },
    gameFavorites: (platform) => w.game[platform],
    linkedProfiles: () => w.links,
    now: () => new Date('2026-11-11T12:00:00.000Z')
  }
}

function link(overrides: Partial<LinkedProfile> = {}): LinkedProfile {
  return {
    id: 'link-1',
    members: [
      { platform: 'vrchat', platformAccountId: VRC_ME, friendId: 'usr_a' },
      { platform: 'chilloutvr', platformAccountId: CVR_ME, friendId: 'cvr-c' }
    ],
    customName: null,
    defaultName: 'Ari',
    preferredPlatform: 'vrchat',
    pictureMode: 'preferred',
    sharedNote: '',
    revision: 1,
    ...overrides
  }
}

function built(w: World): Extract<ReturnType<typeof buildDataExport>, { ok: true }> {
  const result = buildDataExport(sources(w))
  if (!result.ok) throw new Error(`export refused: ${result.reason}`)
  return result
}

describe('buildDataExport', () => {
  it('lists friends by name with their star and note, the same way for both platforms', () => {
    const { file, counts } = built(world())
    expect(file.app).toBe('VRX')
    expect(file.format).toBe(1)
    expect(file.exportedAt).toBe('2026-11-11T12:00:00.000Z')
    expect(file.vrchat).toEqual({
      friendsListLoaded: true,
      gameFavorites: 'off',
      friends: [
        { id: 'usr_a', name: 'Ari', favorite: true, favoriteGroups: [], note: '' },
        { id: 'usr_b', name: 'Bea', favorite: false, favoriteGroups: [], note: 'met at the meetup' }
      ],
      favoriteWorlds: [{ id: 'wrld_1', name: 'Sky', favorite: true, favoriteGroups: [] }]
    })
    expect(file.chilloutvr).toEqual({
      friendsListLoaded: true,
      gameFavorites: 'off',
      friends: [
        { id: 'cvr-c', name: 'Cy', favorite: false, favoriteGroups: [], note: 'plays piano' }
      ],
      favoriteWorlds: []
    })
    expect(Object.keys(file.vrchat ?? {})).toEqual(Object.keys(file.chilloutvr ?? {}))
    expect(counts).toEqual({ friends: 3, notes: 2, favorites: 2 })
  })

  it('reads notes only for the account signed in now and never writes that account id', () => {
    const w = world()
    const { file } = built(w)
    expect(w.noteReads).toEqual([
      ['vrchat', VRC_ME],
      ['chilloutvr', CVR_ME]
    ])
    const text = serializeDataExport(file)
    expect(text).not.toContain(VRC_ME)
    expect(text).not.toContain(CVR_ME)
  })

  it('leaves a signed-out platform as null and exports the other', () => {
    const w = world({ accounts: { vrchat: null, chilloutvr: CVR_ME } })
    const { file, counts } = built(w)
    expect(file.vrchat).toBeNull()
    expect(file.chilloutvr?.friends).toHaveLength(1)
    expect(w.noteReads).toEqual([['chilloutvr', CVR_ME]])
    expect(counts).toEqual({ friends: 1, notes: 1, favorites: 0 })
  })

  it('refuses with no account, before reading anything', () => {
    const w = world({ accounts: { vrchat: null, chilloutvr: null } })
    expect(buildDataExport(sources(w))).toEqual({ ok: false, reason: 'signed-out' })
    expect(w.noteReads).toEqual([])
  })

  it('waits for a friends list: not ready while none has arrived', () => {
    const w = world({ rosters: { vrchat: null, chilloutvr: null } })
    expect(buildDataExport(sources(w))).toEqual({ ok: false, reason: 'not-ready' })
  })

  it('exports when one list has arrived, and marks the one that has not', () => {
    const w = world({ rosters: { vrchat: null, chilloutvr: [{ id: 'cvr-c', name: 'Cy' }] } })
    const { file, counts } = built(w)
    expect(file.vrchat?.friendsListLoaded).toBe(false)
    // Notes and stars still come along, without a name.
    expect(file.vrchat?.friends).toEqual([
      { id: 'usr_a', name: null, favorite: true, favoriteGroups: [], note: '' },
      { id: 'usr_b', name: null, favorite: false, favoriteGroups: [], note: 'met at the meetup' }
    ])
    expect(file.chilloutvr?.friendsListLoaded).toBe(true)
    expect(counts.friends).toBe(1)
  })

  it('keeps a note for someone who is no longer a friend, after the named rows', () => {
    const w = world()
    w.notes.vrchat = { usr_gone: 'old friend', usr_b: '' }
    const { file, counts } = built(w)
    expect(file.vrchat?.friends.map((row) => [row.id, row.name, row.note])).toEqual([
      ['usr_a', 'Ari', ''],
      ['usr_b', 'Bea', ''],
      ['usr_gone', null, 'old friend']
    ])
    expect(counts.notes).toBe(2)
    expect(counts.friends).toBe(3)
  })

  it('adds in-game favorite groups by name when they are already loaded', () => {
    const w = world()
    w.game.vrchat = {
      groups: {
        friend: [
          { key: 'friend:group_0', name: 'Besties' },
          { key: 'friend:group_1', name: 'Dancers' }
        ],
        world: [{ key: 'world:worlds1', name: 'Chill' }]
      },
      friends: { usr_b: ['friend:group_1', 'friend:group_0'], usr_x: ['friend:unknown'] },
      worlds: { wrld_2: ['world:worlds1'], wrld_1: ['world:worlds1'], wrld_3: [] },
      worldNames: [{ worldId: 'wrld_2', name: 'Lake' }]
    }
    const { file, counts } = built(w)
    const bea = file.vrchat?.friends.find((row) => row.id === 'usr_b')
    // Group order follows the account's own order, not the order on the item.
    expect(bea?.favoriteGroups).toEqual(['Besties', 'Dancers'])
    // A key with no known group adds no row.
    expect(file.vrchat?.friends.some((row) => row.id === 'usr_x')).toBe(false)
    expect(file.vrchat?.favoriteWorlds).toEqual([
      { id: 'wrld_2', name: 'Lake', favorite: false, favoriteGroups: ['Chill'] },
      { id: 'wrld_1', name: 'Sky', favorite: true, favoriteGroups: ['Chill'] }
    ])
    // Ari (star), Bea (group), two worlds.
    expect(counts.favorites).toBe(4)
    // No group key leaves the app.
    expect(serializeDataExport(file)).not.toContain('friend:group_0')
  })

  it('says so when the favorite groups of an account could not be included', () => {
    const w = world()
    expect(built(w).gameFavoritesMissing).toBe(false)

    w.game.vrchat = 'unavailable'
    const missing = built(w)
    expect(missing.gameFavoritesMissing).toBe(true)
    expect(missing.file.vrchat?.gameFavorites).toBe('unavailable')
    expect(missing.file.chilloutvr?.gameFavorites).toBe('off')
    // VRX's own stars are still there.
    expect(missing.file.vrchat?.friends.find((row) => row.id === 'usr_a')?.favorite).toBe(true)

    // A signed-out platform's groups are not "missing".
    const oneAccount = world({ accounts: { vrchat: null, chilloutvr: CVR_ME } })
    oneAccount.game.vrchat = 'unavailable'
    expect(built(oneAccount).gameFavoritesMissing).toBe(false)

    w.game.vrchat = { groups: { friend: [], world: [] }, friends: {}, worlds: {}, worldNames: [] }
    const included = built(w)
    expect(included.gameFavoritesMissing).toBe(false)
    expect(included.file.vrchat?.gameFavorites).toBe('included')
  })

  it('exports a link only when both people belong to the accounts signed in now', () => {
    const w = world()
    w.links = [
      link({ customName: 'Ari everywhere', sharedNote: 'same person' }),
      link({
        id: 'link-2',
        defaultName: 'Other',
        members: [
          { platform: 'vrchat', platformAccountId: 'usr_someone_else', friendId: 'usr_z' },
          { platform: 'chilloutvr', platformAccountId: CVR_ME, friendId: 'cvr-z' }
        ]
      })
    ]
    const { file, counts } = built(w)
    expect(file.linkedProfiles).toEqual([
      { name: 'Ari everywhere', vrchatId: 'usr_a', chilloutvrId: 'cvr-c', note: 'same person' }
    ])
    expect(counts.notes).toBe(3)

    const oneAccount = built(
      world({ accounts: { vrchat: VRC_ME, chilloutvr: null }, links: w.links })
    )
    expect(oneAccount.file.linkedProfiles).toEqual([])
  })

  it('writes readable JSON that reads back the same', () => {
    const { file } = built(world())
    const text = serializeDataExport(file)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "vrchat": {')
    expect(JSON.parse(text)).toEqual(file)
  })

  it('handles an ordinary large account', () => {
    const w = world()
    w.rosters.vrchat = Array.from({ length: 5_000 }, (_, i) => ({ id: `usr_${i}`, name: `N${i}` }))
    const { counts } = built(w)
    expect(counts.friends).toBe(5_001)
  })
})

describe('dataExportFileName', () => {
  it('uses the local date, padded', () => {
    expect(dataExportFileName(new Date(2026, 0, 5, 23, 59))).toBe('vrx-export-2026-01-05.json')
    expect(dataExportFileName(new Date(2026, 10, 11))).toBe('vrx-export-2026-11-11.json')
  })
})
