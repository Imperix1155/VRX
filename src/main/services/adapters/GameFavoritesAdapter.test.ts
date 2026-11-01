import { describe, expect, it } from 'vitest'
import {
  buildVrcGroups,
  isCvrUserCategory,
  parseCvrCategories,
  parseCvrItemCategories,
  parseVrcFavoriteLimits,
  parseVrcGroupKey,
  VRC_DEFAULT_FAVORITE_LIMITS
} from './GameFavoritesAdapter'

describe('game favorite reply checks', () => {
  it("falls back to VRCX's limits for anything the reply leaves out", () => {
    expect(parseVrcFavoriteLimits(null)).toEqual(VRC_DEFAULT_FAVORITE_LIMITS)
    expect(
      parseVrcFavoriteLimits({
        maxFavoriteGroups: { friend: 5, world: -1 },
        maxFavoritesPerGroup: {}
      })
    ).toMatchObject({ friend: { groups: 5, perGroup: 150 }, world: { groups: 4, perGroup: 100 } })
  })

  it("builds VRCX's group slots with the user's names, and VRC+ groups only when the account has them", () => {
    const limits = VRC_DEFAULT_FAVORITE_LIMITS
    const plain = buildVrcGroups(limits, [
      { type: 'friend', name: 'group_1', displayName: 'Raid' },
      { type: 'friend', name: 'custom', displayName: null }
    ])
    expect(plain.friend).toEqual([
      { key: 'friend:custom', name: 'Group 1', capacity: 150 },
      { key: 'friend:group_1', name: 'Raid', capacity: 150 },
      { key: 'friend:group_2', name: 'Group 3', capacity: 150 }
    ])
    expect(plain.world).toHaveLength(4)
    const plus = buildVrcGroups(limits, [
      { type: 'vrcPlusWorld', name: 'vrcPlusWorlds1', displayName: 'Plus' }
    ])
    expect(plus.world.at(-1)).toEqual({
      key: 'vrcPlusWorld:vrcPlusWorlds1',
      name: 'Plus',
      capacity: 100
    })
  })

  it('reads back only keys VRX built', () => {
    expect(parseVrcGroupKey('friend:group_0')).toEqual({ type: 'friend', name: 'group_0' })
    expect(parseVrcGroupKey('avatar:avatars1')).toBeNull()
    expect(parseVrcGroupKey('world:../x')).toBeNull()
    expect(parseVrcGroupKey('world')).toBeNull()
  })

  it("keeps only the user's own ChilloutVR categories", () => {
    expect(isCvrUserCategory('world', 'worlds_abc')).toBe(true)
    expect(isCvrUserCategory('world', 'wrldmine')).toBe(false)
    expect(isCvrUserCategory('friend', 'friends_online')).toBe(false)
    expect(isCvrUserCategory('friend', 'worlds_abc')).toBe(false)
    expect(
      parseCvrCategories({
        friends: [
          { id: 'friends_x', name: '  Best   pals ' },
          { id: 'frndoffline', name: 'Off' }
        ],
        worlds: 'nope'
      })
    ).toEqual({ friend: [{ key: 'friends_x', name: 'Best pals', capacity: null }], world: [] })
  })

  it("refuses to guess an item's categories", () => {
    const id = 'c4a1d0f2-6b8e-4c1d-9a7e-2f3b4c5d6e7f'
    expect(parseCvrItemCategories({ id, categories: ['worlds_a', 3] }, id)).toEqual(['worlds_a'])
    expect(parseCvrItemCategories({ id }, id)).toBeNull()
    expect(parseCvrItemCategories({ id: 'other', categories: [] }, id)).toBeNull()
  })
})
