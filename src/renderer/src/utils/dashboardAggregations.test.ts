import { describe, expect, it } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import { getDashboardStats, getHotInstances } from './dashboardAggregations'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const instance = (worldId: string, worldName: string | null = 'World'): InstanceInfo => ({
  worldId,
  instanceId: `${worldId}:12345~public`,
  worldName,
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  region: 'us',
  userCount: null
})

const vrcFriend = (
  id: string,
  state: Friend['presence']['state'],
  inst: InstanceInfo | null = null
): Friend => ({
  platformUserId: id,
  platform: 'vrchat',
  displayName: `User ${id}`,
  avatarUrl: null,
  presence: { state },
  status: 'online',
  statusDescription: null,
  trustRank: null,
  instance: inst,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
})

const cvrFriend = (
  id: string,
  state: 'in-game' | 'offline',
  inst: InstanceInfo | null = null
): Friend => ({
  platformUserId: id,
  platform: 'chilloutvr',
  displayName: `CVR User ${id}`,
  avatarUrl: null,
  presence: { state },
  status: null,
  statusDescription: null,
  trustRank: null,
  instance: inst,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
})

// ─── getDashboardStats ────────────────────────────────────────────────────────

describe('getDashboardStats', () => {
  it('returns zeros for an empty list', () => {
    const stats = getDashboardStats([], 0)
    expect(stats).toEqual({ onlineCount: 0, inGameCount: 0, hotCount: 0 })
  })

  it('counts active as online but not in-game', () => {
    const stats = getDashboardStats([vrcFriend('a', 'active')], 0)
    expect(stats.onlineCount).toBe(1)
    expect(stats.inGameCount).toBe(0)
  })

  it('counts in-game as both online and in-game', () => {
    const stats = getDashboardStats([vrcFriend('a', 'in-game', instance('wrld_1'))], 0)
    expect(stats.onlineCount).toBe(1)
    expect(stats.inGameCount).toBe(1)
  })

  it('does not count offline friends', () => {
    const stats = getDashboardStats([vrcFriend('a', 'offline')], 0)
    expect(stats.onlineCount).toBe(0)
    expect(stats.inGameCount).toBe(0)
  })

  it('passes hotCount through directly', () => {
    const stats = getDashboardStats([], 5)
    expect(stats.hotCount).toBe(5)
  })

  it('aggregates across platforms', () => {
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', instance('w1')),
      vrcFriend('b', 'active'),
      cvrFriend('c', 'in-game', instance('w2')),
      cvrFriend('d', 'offline')
    ]
    const stats = getDashboardStats(friends, 2)
    expect(stats.onlineCount).toBe(3)
    expect(stats.inGameCount).toBe(2)
    expect(stats.hotCount).toBe(2)
  })
})

// ─── getHotInstances ──────────────────────────────────────────────────────────

describe('getHotInstances', () => {
  it('returns empty for no friends', () => {
    expect(getHotInstances([])).toEqual([])
  })

  it('excludes friends with null instance', () => {
    const friends: Friend[] = [vrcFriend('a', 'active', null), vrcFriend('b', 'in-game', null)]
    expect(getHotInstances(friends)).toHaveLength(0)
  })

  it('groups friends in the same world', () => {
    const inst = instance('wrld_1', 'The Great Pug')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst),
      vrcFriend('b', 'in-game', inst),
      vrcFriend('c', 'in-game', inst)
    ]
    const result = getHotInstances(friends)
    expect(result).toHaveLength(1)
    expect(result[0].friendCount).toBe(3)
    expect(result[0].worldId).toBe('wrld_1')
    expect(result[0].worldName).toBe('The Great Pug')
  })

  it('sorts by friend count descending', () => {
    const inst1 = instance('wrld_1', 'Smaller World')
    const inst2 = instance('wrld_2', 'Bigger World')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst1),
      vrcFriend('b', 'in-game', inst2),
      vrcFriend('c', 'in-game', inst2),
      vrcFriend('d', 'in-game', inst2)
    ]
    const result = getHotInstances(friends)
    expect(result[0].worldId).toBe('wrld_2')
    expect(result[0].friendCount).toBe(3)
    expect(result[1].worldId).toBe('wrld_1')
    expect(result[1].friendCount).toBe(1)
  })

  it('breaks ties by worldName then worldId (stable/deterministic)', () => {
    const inst1 = instance('wrld_z', 'Alpha')
    const inst2 = instance('wrld_a', 'Beta')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst2), // Beta wrld_a
      vrcFriend('b', 'in-game', inst1) // Alpha wrld_z
    ]
    const result = getHotInstances(friends)
    // Both have friendCount 1; tiebreak: Alpha < Beta
    expect(result[0].worldId).toBe('wrld_z')
    expect(result[1].worldId).toBe('wrld_a')
  })

  it('breaks ties by worldId when worldNames are equal', () => {
    const inst1 = instance('wrld_b', 'Same Name')
    const inst2 = instance('wrld_a', 'Same Name')
    const friends: Friend[] = [vrcFriend('a', 'in-game', inst1), vrcFriend('b', 'in-game', inst2)]
    const result = getHotInstances(friends)
    expect(result[0].worldId).toBe('wrld_a')
    expect(result[1].worldId).toBe('wrld_b')
  })

  it('caps at 6 results', () => {
    const friends: Friend[] = Array.from({ length: 8 }, (_, i) =>
      vrcFriend(`u${i}`, 'in-game', instance(`wrld_${i}`, `World ${i}`))
    )
    expect(getHotInstances(friends)).toHaveLength(6)
  })

  it('handles null worldName in tiebreak without crashing', () => {
    const inst1 = instance('wrld_1', null)
    const inst2 = instance('wrld_2', 'Named World')
    const friends: Friend[] = [vrcFriend('a', 'in-game', inst1), vrcFriend('b', 'in-game', inst2)]
    // Should not throw
    const result = getHotInstances(friends)
    expect(result).toHaveLength(2)
    // Named world sorts before null-named
    expect(result[0].worldId).toBe('wrld_2')
  })

  it('carries the correct platform from the first friend in the world', () => {
    const inst = instance('wrld_1', 'CVR World')
    const friends: Friend[] = [cvrFriend('a', 'in-game', inst)]
    const result = getHotInstances(friends)
    expect(result[0].platform).toBe('chilloutvr')
  })
})
