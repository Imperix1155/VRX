import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPLORE_WORLD_TOTAL, EXPLORE_WORLD_TOTALS, type ExploreWorld } from './explore'
import { rankExploreWorlds, selectExploreWorlds } from './exploreRanking'
import type { Platform } from './types'

const listSeeds = { vrchat: 11, chilloutvr: 37 }

function world(
  platform: Platform,
  worldId: string,
  value = 1,
  overrides: Partial<ExploreWorld> = {}
): ExploreWorld {
  return {
    platform,
    worldId,
    worldRef: `fixture-${platform}-${worldId}`,
    name: worldId,
    thumbnailUrl: null,
    activity: {
      state: 'complete',
      value,
      source: platform === 'vrchat' ? 'vrc-world-occupants' : 'cvr-public-rooms'
    },
    visibleRoomCount: { state: 'unknown', value: null, source: 'visible-rooms' },
    popularity: null,
    sourceOrder: 0,
    ...overrides
  }
}

function ids(worlds: readonly ExploreWorld[]): string[] {
  return worlds.map((entry) => entry.worldId)
}

function swapOwner(entry: ExploreWorld): ExploreWorld {
  return { ...entry, platform: entry.platform === 'vrchat' ? 'chilloutvr' : 'vrchat' }
}

describe('rankExploreWorlds', () => {
  it('ranks VRC by aggregate activity, then popularity, then code-point world ID', () => {
    const input = [
      world('vrchat', 'b', 20, { popularity: 5 }),
      world('vrchat', 'a', 20, { popularity: 5 }),
      world('vrchat', 'popular', 20, { popularity: 50 }),
      world('vrchat', 'busy', 21, { popularity: 0 }),
      world('vrchat', 'missing-popularity', 20)
    ]
    const before = structuredClone(input)
    expect(ids(rankExploreWorlds('vrchat', input))).toEqual([
      'busy',
      'popular',
      'a',
      'b',
      'missing-popularity'
    ])
    expect(input).toEqual(before)
  })

  it('places known zero ahead of invalid or unknown activity without inventing counts', () => {
    const input = [
      world('vrchat', 'unknown', 0, {
        activity: { state: 'unknown', value: null, source: 'unknown' }
      }),
      world('vrchat', 'negative', -1),
      world('vrchat', 'nan', Number.NaN),
      world('vrchat', 'infinite', Number.POSITIVE_INFINITY),
      world('vrchat', 'fractional', 0.5),
      world('vrchat', 'unsafe', Number.MAX_SAFE_INTEGER + 1),
      world('vrchat', 'zero', 0)
    ]
    expect(rankExploreWorlds('vrchat', input)[0]?.worldId).toBe('zero')
    expect(rankExploreWorlds('vrchat', input)[0]?.activity.value).toBe(0)
  })

  it('does not treat another count source as VRC aggregate activity', () => {
    expect(
      ids(
        rankExploreWorlds('vrchat', [
          world('vrchat', 'room-count', 999, {
            activity: { state: 'complete', value: 999, source: 'visible-rooms' }
          }),
          world('vrchat', 'aggregate', 1)
        ])
      )
    ).toEqual(['aggregate', 'room-count'])
  })

  it('ranks complete CVR public totals first, then incomplete candidates by stable source order', () => {
    const input = [
      world('chilloutvr', 'unknown-b', 0, {
        activity: { state: 'unknown', value: null, source: 'cvr-public-rooms' },
        sourceOrder: 2
      }),
      world('chilloutvr', 'partial', 0, {
        activity: { state: 'partial', value: null, source: 'cvr-public-rooms' },
        sourceOrder: 1
      }),
      world('chilloutvr', 'unknown-a', 0, {
        activity: { state: 'unknown', value: null, source: 'cvr-public-rooms' },
        sourceOrder: 2
      }),
      world('chilloutvr', 'zero', 0),
      world('chilloutvr', 'busy-b', 10, { popularity: 100 }),
      world('chilloutvr', 'busy-a', 10, { popularity: 0 })
    ]
    expect(ids(rankExploreWorlds('chilloutvr', input))).toEqual([
      'busy-a',
      'busy-b',
      'zero',
      'partial',
      'unknown-a',
      'unknown-b'
    ])
  })

  it('never promotes an unverified category-like activity to CVR public occupancy', () => {
    const unverified = world('chilloutvr', 'unverified', 99999, {
      activity: { state: 'complete', value: 99999, source: 'unknown' },
      sourceOrder: 0
    })
    expect(
      ids(rankExploreWorlds('chilloutvr', [unverified, world('chilloutvr', 'public', 1)]))
    ).toEqual(['public', 'unverified'])
  })

  it('keeps one record per world and isolates platform inputs', () => {
    const first = world('vrchat', '__proto__', 2)
    expect(
      rankExploreWorlds('vrchat', [
        first,
        world('vrchat', '__proto__', 1000),
        world('chilloutvr', 'other', 2000),
        world('vrchat', '', 3000)
      ])
    ).toEqual([first])
  })
})

describe('selectExploreWorlds', () => {
  const lists = {
    vrchat: [world('vrchat', 'a'), world('vrchat', 'c'), world('vrchat', 'e')],
    chilloutvr: [world('chilloutvr', 'b'), world('chilloutvr', 'd'), world('chilloutvr', 'f')]
  }

  it('uses four by default and preserves the approved 2/4/6 choices', () => {
    expect(EXPLORE_WORLD_TOTALS).toEqual([2, 4, 6])
    const selected = selectExploreWorlds({
      lists,
      filter: 'all',
      total: DEFAULT_EXPLORE_WORLD_TOTAL,
      listSeeds
    })
    expect(ids(selected)).toEqual(['a', 'b', 'd', 'c'])
  })

  it.each(EXPLORE_WORLD_TOTALS)(
    'gives equal shares at total %i and alternates pair leaders',
    (total) => {
      const selected = selectExploreWorlds({ lists, filter: 'all', total, listSeeds })
      expect(ids(selected)).toEqual(['a', 'b', 'd', 'c', 'e', 'f'].slice(0, total))
      expect(selected.filter((entry) => entry.platform === 'vrchat')).toHaveLength(total / 2)
      expect(selected.filter((entry) => entry.platform === 'chilloutvr')).toHaveLength(total / 2)
    }
  )

  it('chooses the leader by candidate IDs, regardless of platform population', () => {
    const selected = selectExploreWorlds({
      lists: {
        vrchat: [world('vrchat', 'z', 999999)],
        chilloutvr: [world('chilloutvr', 'a', 1)]
      },
      filter: 'all',
      total: 2,
      listSeeds
    })
    expect(selected[0]?.platform).toBe('chilloutvr')
  })

  it('compares complete ordered ID lists when the leading IDs match', () => {
    const selected = selectExploreWorlds({
      lists: {
        vrchat: [world('vrchat', 'same'), world('vrchat', 'z')],
        chilloutvr: [world('chilloutvr', 'same'), world('chilloutvr', 'a')]
      },
      filter: 'all',
      total: 2,
      listSeeds
    })
    expect(selected[0]?.platform).toBe('chilloutvr')
  })

  it('uses supplied neutral session seeds only for indistinguishable ID lists', () => {
    const tied = {
      vrchat: [world('vrchat', 'same')],
      chilloutvr: [world('chilloutvr', 'same')]
    }
    expect(
      selectExploreWorlds({
        lists: tied,
        filter: 'all',
        total: 2,
        listSeeds: { vrchat: 9, chilloutvr: 2 }
      })[0]?.platform
    ).toBe('chilloutvr')
    expect(
      selectExploreWorlds({
        lists: tied,
        filter: 'all',
        total: 2,
        listSeeds: { vrchat: 2, chilloutvr: 9 }
      })[0]?.platform
    ).toBe('vrchat')
    expect(() =>
      selectExploreWorlds({
        lists: tied,
        filter: 'all',
        total: 2,
        listSeeds: { vrchat: 2, chilloutvr: 2 }
      })
    ).toThrow(RangeError)
  })

  it('filters without borrowing and gives Dashboard the same two-card prefix', () => {
    expect(ids(selectExploreWorlds({ lists, filter: 'vrchat', total: 4, listSeeds }))).toEqual([
      'a',
      'c',
      'e'
    ])
    expect(ids(selectExploreWorlds({ lists, filter: 'chilloutvr', total: 4, listSeeds }))).toEqual([
      'b',
      'd',
      'f'
    ])
    const dashboard = selectExploreWorlds({ lists, filter: 'all', total: 2, listSeeds })
    const explore = selectExploreWorlds({ lists, filter: 'all', total: 6, listSeeds })
    expect(dashboard).toEqual(explore.slice(0, 2))
  })

  it('backfills symmetrically at every approved total without placeholders or mutation', () => {
    for (let vrcCount = 0; vrcCount <= 8; vrcCount += 1) {
      for (let cvrCount = 0; cvrCount <= 8; cvrCount += 1) {
        const input = {
          vrchat: Array.from({ length: vrcCount }, (_, n) => world('vrchat', `a${n}`)),
          chilloutvr: Array.from({ length: cvrCount }, (_, n) => world('chilloutvr', `b${n}`))
        }
        const before = structuredClone(input)
        for (const total of EXPLORE_WORLD_TOTALS) {
          const selected = selectExploreWorlds({ lists: input, filter: 'all', total, listSeeds })
          expect(selected).toHaveLength(Math.min(total, vrcCount + cvrCount))
          expect(new Set(selected.map((entry) => `${entry.platform}:${entry.worldId}`)).size).toBe(
            selected.length
          )
          const swapped = selectExploreWorlds({
            lists: {
              vrchat: input.chilloutvr.map(swapOwner),
              chilloutvr: input.vrchat.map(swapOwner)
            },
            filter: 'all',
            total,
            listSeeds: { vrchat: listSeeds.chilloutvr, chilloutvr: listSeeds.vrchat }
          })
          expect(swapped).toEqual(selected.map(swapOwner))
        }
        expect(input).toEqual(before)
      }
    }
  })

  it('retains each platform native order through a one-sided backfill', () => {
    expect(
      ids(
        selectExploreWorlds({
          lists: {
            vrchat: [
              world('vrchat', 'z'),
              world('vrchat', 'y'),
              world('vrchat', 'x'),
              world('vrchat', 'w')
            ],
            chilloutvr: [world('chilloutvr', 'a')]
          },
          filter: 'all',
          total: 4,
          listSeeds
        })
      )
    ).toEqual(['a', 'z', 'y', 'x'])
  })
})
