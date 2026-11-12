import { describe, expect, it } from 'vitest'
import type { GameFavorites } from '@shared/gameFavorites'
import type { Platform } from '@shared/types'
import { splitFavoritesByGroup, type FavoriteSubgroup } from './favoriteGroups'

function favorites(
  groups: Array<[key: string, name: string]>,
  friends: Record<string, string[]>
): GameFavorites {
  return {
    oneGroupPerItem: true,
    groups: {
      friend: groups.map(([key, name]) => ({ key, name, capacity: null, count: 0 })),
      world: []
    },
    friends,
    worlds: {},
    worldList: []
  }
}

interface Row {
  name: string
  accounts: Array<{
    platform: Platform
    platformUserId: string
    presence?: { state: 'in-game' | 'offline' }
  }>
}

function row(name: string, ...accounts: Array<[Platform, string]>): Row {
  return {
    name,
    accounts: accounts.map(([platform, platformUserId]) => ({ platform, platformUserId }))
  }
}

function names(parts: FavoriteSubgroup<Row>[]): Array<[string, string | null, string[]]> {
  return parts.map((part) => [part.key, part.name, part.rows.map((r) => r.name)])
}

describe('splitFavoritesByGroup', () => {
  it('lists VRChat groups, then ChilloutVR categories, then VRX-only stars', () => {
    const rows = [
      row('Zed', ['chilloutvr', 'c1']),
      row('Amy', ['vrchat', 'v1']),
      row('Bo', ['vrchat', 'v2']),
      row('Cy', ['vrchat', 'v3']),
      row('Di', ['chilloutvr', 'c2'])
    ]
    const parts = splitFavoritesByGroup(rows, {
      vrchat: favorites(
        [
          ['g1', 'Besties'],
          ['g2', 'Dance crew']
        ],
        { v1: ['g2'], v2: ['g1'] }
      ),
      chilloutvr: favorites([['k1', 'Pals']], { c1: ['k1'] })
    })
    expect(names(parts)).toEqual([
      ['vrchat:g1', 'Besties', ['Bo']],
      ['vrchat:g2', 'Dance crew', ['Amy']],
      ['chilloutvr:k1', 'Pals', ['Zed']],
      ['vrx', null, ['Cy', 'Di']]
    ])
    expect(parts.map((part) => part.platform)).toEqual(['vrchat', 'vrchat', 'chilloutvr', null])
  })

  it('keeps each part in the order the rows arrived in', () => {
    const parts = splitFavoritesByGroup(
      [row('B', ['vrchat', 'v2']), row('A', ['vrchat', 'v1']), row('C', ['vrchat', 'v3'])],
      { vrchat: favorites([['g1', 'One']], { v1: ['g1'], v2: ['g1'] }), chilloutvr: null }
    )
    expect(names(parts)).toEqual([
      ['vrchat:g1', 'One', ['B', 'A']],
      ['vrx', null, ['C']]
    ])
  })

  it('shows a friend once, under the first of their groups in the account’s order', () => {
    const parts = splitFavoritesByGroup(
      [row('Multi', ['chilloutvr', 'c1']), row('Other', ['chilloutvr', 'c2'])],
      {
        vrchat: null,
        chilloutvr: favorites(
          [
            ['k1', 'First'],
            ['k2', 'Second']
          ],
          // The item lists its later category first.
          { c1: ['k2', 'k1'], c2: ['k2'] }
        )
      }
    )
    expect(names(parts)).toEqual([
      ['chilloutvr:k1', 'First', ['Multi']],
      ['chilloutvr:k2', 'Second', ['Other']]
    ])
  })

  it('puts a linked person under the first group any of their accounts is in', () => {
    const parts = splitFavoritesByGroup(
      [row('Linked', ['chilloutvr', 'c1'], ['vrchat', 'v1']), row('Solo', ['chilloutvr', 'c2'])],
      {
        vrchat: favorites([['g1', 'VRC pals']], { v1: ['g1'] }),
        chilloutvr: favorites([['k1', 'CVR pals']], { c1: ['k1'], c2: ['k1'] })
      }
    )
    expect(names(parts)).toEqual([
      ['vrchat:g1', 'VRC pals', ['Linked']],
      ['chilloutvr:k1', 'CVR pals', ['Solo']]
    ])
  })

  it('asks the account that is in the game first, so the heading matches the row', () => {
    const game = {
      vrchat: favorites([['g1', 'Work']], { v1: ['g1'], v9: ['g1'] }),
      chilloutvr: favorites([['k1', 'Pals']], { c1: ['k1'], c9: ['k1'] })
    }
    const linked = (vrc: 'in-game' | 'offline', cvr: 'in-game' | 'offline'): Row => ({
      name: 'Dex',
      accounts: [
        { platform: 'vrchat', platformUserId: 'v1', presence: { state: vrc } },
        { platform: 'chilloutvr', platformUserId: 'c1', presence: { state: cvr } }
      ]
    })
    // One more person in each group, so both headings always exist.
    const others = [row('Amy', ['vrchat', 'v9']), row('Zed', ['chilloutvr', 'c9'])]
    const where = (dex: Row): string | undefined =>
      splitFavoritesByGroup([dex, ...others], game).find((part) => part.rows.includes(dex))?.key

    // Only the ChilloutVR account is in the game: the ChilloutVR group.
    expect(where(linked('offline', 'in-game'))).toBe('chilloutvr:k1')
    // Only the VRChat account, or both: VRChat's group comes first as before.
    expect(where(linked('in-game', 'offline'))).toBe('vrchat:g1')
    expect(where(linked('in-game', 'in-game'))).toBe('vrchat:g1')
    // The in-game account is in no group: the other account's group still counts.
    const noGroup = {
      ...game,
      chilloutvr: favorites([['k1', 'Pals']], { c9: ['k1'] })
    }
    const dex = linked('offline', 'in-game')
    expect(
      splitFavoritesByGroup([dex, row('Zed', ['chilloutvr', 'c9'])], noGroup).find((part) =>
        part.rows.includes(dex)
      )?.key
    ).toBe('vrchat:g1')
  })

  it('gives no parts when everyone would sit under one heading', () => {
    const rows = [row('A', ['vrchat', 'v1']), row('B', ['vrchat', 'v2'])]
    // VRX stars only, with no game favorites at all.
    expect(splitFavoritesByGroup(rows, { vrchat: null, chilloutvr: null })).toEqual([])
    // Everyone in the same group.
    expect(
      splitFavoritesByGroup(rows, {
        vrchat: favorites([['g1', 'One']], { v1: ['g1'], v2: ['g1'] }),
        chilloutvr: null
      })
    ).toEqual([])
    expect(splitFavoritesByGroup([], { vrchat: null, chilloutvr: null })).toEqual([])
  })

  it('treats a group key the account no longer lists as VRX-only', () => {
    const parts = splitFavoritesByGroup(
      [row('Ghost', ['vrchat', 'v1']), row('Real', ['vrchat', 'v2'])],
      { vrchat: favorites([['g1', 'One']], { v1: ['gone'], v2: ['g1'] }), chilloutvr: null }
    )
    expect(names(parts)).toEqual([
      ['vrchat:g1', 'One', ['Real']],
      ['vrx', null, ['Ghost']]
    ])
  })

  it('never reads a friend ID off the object prototype', () => {
    const parts = splitFavoritesByGroup(
      [row('Proto', ['vrchat', 'constructor']), row('Real', ['vrchat', 'v2'])],
      { vrchat: favorites([['g1', 'One']], { v2: ['g1'] }), chilloutvr: null }
    )
    expect(names(parts)).toEqual([
      ['vrchat:g1', 'One', ['Real']],
      ['vrx', null, ['Proto']]
    ])
  })
})
