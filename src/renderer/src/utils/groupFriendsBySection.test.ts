import { describe, expect, it } from 'vitest'
import type { Friend } from '@shared/types'
import { FRIEND_SECTION_ORDER, groupFriendsBySection } from './groupFriendsBySection'

const mk = (id: string, displayName: string, state: Friend['presence']['state']): Friend => ({
  platformUserId: id,
  platform: 'vrchat',
  displayName,
  avatarUrl: null,
  presence: { state },
  status: 'online',
  statusDescription: null,
  trustRank: null,
  instance: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
})

describe('groupFriendsBySection', () => {
  it('returns the three sections in order, all empty, for an empty list', () => {
    const groups = groupFriendsBySection([])
    expect(groups.map((g) => g.section)).toEqual(['in-game', 'online', 'offline'])
    expect(groups.every((g) => g.friends.length === 0)).toBe(true)
  })

  it('matches the exported FRIEND_SECTION_ORDER', () => {
    expect(groupFriendsBySection([]).map((g) => g.section)).toEqual(FRIEND_SECTION_ORDER)
  })

  it('buckets by presence state — "active" maps to the "online" section', () => {
    const groups = groupFriendsBySection([
      mk('1', 'Anna', 'in-game'),
      mk('2', 'Ben', 'active'),
      mk('3', 'Cara', 'offline')
    ])
    const bySection = Object.fromEntries(groups.map((g) => [g.section, g.friends]))
    expect(bySection['in-game']?.map((f) => f.displayName)).toEqual(['Anna'])
    expect(bySection.online?.map((f) => f.displayName)).toEqual(['Ben'])
    expect(bySection.offline?.map((f) => f.displayName)).toEqual(['Cara'])
  })

  it('sorts alphabetically (case-insensitive) within each section', () => {
    const groups = groupFriendsBySection([
      mk('1', 'zed', 'in-game'),
      mk('2', 'Anna', 'in-game'),
      mk('3', 'Yara', 'in-game')
    ])
    expect(groups[0]?.friends.map((f) => f.displayName)).toEqual(['Anna', 'Yara', 'zed'])
  })

  it('counts reflect only the friends passed in (caller applies the platform filter first)', () => {
    const groups = groupFriendsBySection([mk('1', 'Anna', 'in-game'), mk('2', 'Ben', 'in-game')])
    expect(groups.find((g) => g.section === 'in-game')?.friends.length).toBe(2)
    expect(groups.find((g) => g.section === 'online')?.friends.length).toBe(0)
  })
})
