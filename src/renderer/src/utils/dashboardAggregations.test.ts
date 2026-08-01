import { describe, expect, it } from 'vitest'
import type { AdapterEvent, Friend, InstanceInfo } from '@shared/types'
import {
  FriendAlerts,
  type FriendAlert,
  type HotInstanceAlert
} from '../../../main/services/friendAlerts'
import { getDashboardStats, getHotInstances } from './dashboardAggregations'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const instance = (
  worldId: string,
  worldName: string | null = 'World',
  instanceId: string = `${worldId}:12345~public`
): InstanceInfo => ({
  worldId,
  instanceId,
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

  it('respects a custom threshold (VRX-78): 1 shows singles, 5 filters below five', () => {
    const solo = instance('wrld_solo', 'Quiet World')
    const trio = instance('wrld_trio', 'Busy World')
    const friends: Friend[] = [
      vrcFriend('s1', 'in-game', solo),
      vrcFriend('t1', 'in-game', trio),
      vrcFriend('t2', 'in-game', trio),
      vrcFriend('t3', 'in-game', trio)
    ]
    // Threshold 1: every occupied world qualifies, including the single friend.
    expect(getHotInstances(friends, 1)).toHaveLength(2)
    // Threshold 5: nothing reaches five friends.
    expect(getHotInstances(friends, 5)).toHaveLength(0)
    // Default (no arg) stays the owner-rule 2+.
    expect(getHotInstances(friends)).toHaveLength(1)
  })

  it('groups friends in the same EXACT instance and carries its identity (VRX-237)', () => {
    const inst = instance('wrld_1', 'The Great Pug')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst),
      vrcFriend('b', 'in-game', inst),
      vrcFriend('c', 'in-game', inst)
    ]
    const result = getHotInstances(friends)
    expect(result).toHaveLength(1)
    expect(result[0]!.friendCount).toBe(3)
    expect(result[0]!.worldId).toBe('wrld_1')
    expect(result[0]!.worldName).toBe('The Great Pug')
    expect(result[0]!.instanceId).toBe('wrld_1:12345~public')
    expect(result[0]!.members.map((m) => m.platformUserId)).toEqual(['a', 'b', 'c'])
  })

  it('Fish Pyramid near-miss: same world, three DIFFERENT instances → ZERO hot cards (VRX-237)', () => {
    // The owner's real anecdote: three friends in the Fish Pyramid world, each
    // in their own instance — the old world-grouping showed a hot card and
    // implied they were hanging out together. They were not.
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', instance('wrld_fish', 'Fish Pyramid', 'wrld_fish:aaa~public')),
      vrcFriend('b', 'in-game', instance('wrld_fish', 'Fish Pyramid', 'wrld_fish:bbb~public')),
      vrcFriend('c', 'in-game', instance('wrld_fish', 'Fish Pyramid', 'wrld_fish:ccc~public'))
    ]
    expect(getHotInstances(friends, 2)).toEqual([])
  })

  it('Fish Pyramid: two of the three share one instanceId → ONE card with exactly those two', () => {
    const shared = instance('wrld_fish', 'Fish Pyramid', 'wrld_fish:aaa~public')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', shared),
      vrcFriend('b', 'in-game', instance('wrld_fish', 'Fish Pyramid', 'wrld_fish:bbb~public')),
      vrcFriend('c', 'in-game', shared)
    ]
    const result = getHotInstances(friends, 2)
    expect(result).toHaveLength(1)
    expect(result[0]!.instanceId).toBe('wrld_fish:aaa~public')
    expect(result[0]!.worldName).toBe('Fish Pyramid')
    expect(result[0]!.friendCount).toBe(2)
    // Exactly the two sharers — alphabetical, and the third friend is nowhere.
    expect(result[0]!.members.map((m) => m.platformUserId)).toEqual(['a', 'c'])
    expect(result[0]!.friendNames).toEqual(['User a', 'User c'])
  })

  it('mixed instance types in the same world do NOT group — togetherness is never same-type (VRX-237)', () => {
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', instance('wrld_1', 'Mixed World', 'wrld_1:aaa~public')),
      vrcFriend('b', 'in-game', {
        ...instance('wrld_1', 'Mixed World', 'wrld_1:bbb~friendsPlus'),
        type: 'friends-plus',
        openness: 'friends-plus'
      })
    ]
    expect(getHotInstances(friends, 2)).toEqual([])
  })

  it('collects the friend display names, sorted alphabetically (VRX-198)', () => {
    const inst = instance('wrld_1', 'The Great Pug')
    // deliberately out of order → the aggregation must sort them
    const friends: Friend[] = [
      vrcFriend('c', 'in-game', inst),
      vrcFriend('a', 'in-game', inst),
      vrcFriend('b', 'in-game', inst)
    ]
    const result = getHotInstances(friends)
    expect(result[0]!.friendNames).toEqual(['User a', 'User b', 'User c'])
    // one name per friend — the card slices the first few and derives "+N" from the count
    expect(result[0]!.friendNames).toHaveLength(result[0]!.friendCount)
  })

  it('excludes instances with only 1 friend (a lone friend is not "hot")', () => {
    const solo = instance('wrld_solo', 'Lonely World')
    const pair = instance('wrld_pair', 'Busy World')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', solo),
      vrcFriend('b', 'in-game', pair),
      vrcFriend('c', 'in-game', pair)
    ]
    const result = getHotInstances(friends)
    expect(result).toHaveLength(1)
    expect(result[0]!.worldId).toBe('wrld_pair')
    expect(result[0]!.friendCount).toBe(2)
  })

  it('sorts by friend count descending', () => {
    const inst1 = instance('wrld_1', 'Smaller World')
    const inst2 = instance('wrld_2', 'Bigger World')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst1),
      vrcFriend('e', 'in-game', inst1),
      vrcFriend('b', 'in-game', inst2),
      vrcFriend('c', 'in-game', inst2),
      vrcFriend('d', 'in-game', inst2)
    ]
    const result = getHotInstances(friends)
    expect(result[0]!.worldId).toBe('wrld_2')
    expect(result[0]!.friendCount).toBe(3)
    expect(result[1]!.worldId).toBe('wrld_1')
    expect(result[1]!.friendCount).toBe(2)
  })

  it('breaks ties by worldName then worldId (stable/deterministic)', () => {
    const inst1 = instance('wrld_z', 'Alpha')
    const inst2 = instance('wrld_a', 'Beta')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst2), // Beta wrld_a
      vrcFriend('b', 'in-game', inst2),
      vrcFriend('c', 'in-game', inst1), // Alpha wrld_z
      vrcFriend('d', 'in-game', inst1)
    ]
    const result = getHotInstances(friends)
    // Both have friendCount 2; tiebreak: Alpha < Beta
    expect(result[0]!.worldId).toBe('wrld_z')
    expect(result[1]!.worldId).toBe('wrld_a')
  })

  it('breaks ties by the composite group key when worldNames are equal (VRX-237)', () => {
    const inst1 = instance('wrld_b', 'Same Name')
    const inst2 = instance('wrld_a', 'Same Name')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst1),
      vrcFriend('c', 'in-game', inst1),
      vrcFriend('b', 'in-game', inst2),
      vrcFriend('d', 'in-game', inst2)
    ]
    const result = getHotInstances(friends)
    expect(result[0]!.worldId).toBe('wrld_a')
    expect(result[1]!.worldId).toBe('wrld_b')
  })

  it('caps at 6 results', () => {
    // 8 worlds, each with 2 friends (all "hot") → capped at 6.
    const friends: Friend[] = Array.from({ length: 8 }, (_, i) => [
      vrcFriend(`u${i}a`, 'in-game', instance(`wrld_${i}`, `World ${i}`)),
      vrcFriend(`u${i}b`, 'in-game', instance(`wrld_${i}`, `World ${i}`))
    ]).flat()
    expect(getHotInstances(friends)).toHaveLength(6)
  })

  it('handles null worldName in tiebreak without crashing', () => {
    const inst1 = instance('wrld_1', null)
    const inst2 = instance('wrld_2', 'Named World')
    const friends: Friend[] = [
      vrcFriend('a', 'in-game', inst1),
      vrcFriend('c', 'in-game', inst1),
      vrcFriend('b', 'in-game', inst2),
      vrcFriend('d', 'in-game', inst2)
    ]
    // Should not throw
    const result = getHotInstances(friends)
    expect(result).toHaveLength(2)
    // Named world sorts before null-named
    expect(result[0]!.worldId).toBe('wrld_2')
  })

  it('carries the correct platform from the instance members', () => {
    const inst = instance('wrld_1', 'CVR World')
    const friends: Friend[] = [cvrFriend('a', 'in-game', inst), cvrFriend('b', 'in-game', inst)]
    const result = getHotInstances(friends)
    expect(result[0]!.platform).toBe('chilloutvr')
  })
})

// ─── Alignment pin: dashboard grouping ≡ alert-engine hot key (VRX-237) ──────

describe('hot-instance key alignment (VRX-237)', () => {
  it('the dashboard grouping and the FriendAlerts hot key agree on the same roster', () => {
    // Same roster, two consumers, ONE shared hotInstanceKey: the Fish Pyramid
    // near-miss produces NO hot alert and NO hot card; moving one friend into
    // another's exact instance produces exactly one of each — for the SAME
    // instance id.
    const alerts: FriendAlert[] = []
    const engine = new FriendAlerts({
      notify: (alert) => alerts.push(alert),
      clock: () => 0,
      isEnabled: () => true,
      hotInstanceThreshold: () => 2,
      resolveName: () => null
    })
    const event = (f: Friend): AdapterEvent => ({
      type: 'friend-presence',
      platform: f.platform,
      friend: f
    })
    const pyramid = (instanceId: string): InstanceInfo =>
      instance('wrld_fish', 'Fish Pyramid', instanceId)

    const a = vrcFriend('a', 'in-game', pyramid('wrld_fish:aaa~public'))
    const b = vrcFriend('b', 'in-game', pyramid('wrld_fish:bbb~public'))
    const c = vrcFriend('c', 'in-game', pyramid('wrld_fish:ccc~public'))

    // Baseline offline first — a never-seen in-game friend baselines silently.
    for (const f of [a, b, c]) {
      engine.consume(event({ ...f, presence: { state: 'offline' }, instance: null }))
    }
    for (const f of [a, b, c]) engine.consume(event(f))

    // Near-miss: three different instances of one world — NEITHER consumer
    // calls it hot (the false same-world signal is dead on both sides).
    expect(alerts.filter((x) => x.type === 'hot-instance')).toEqual([])
    expect(getHotInstances([a, b, c], 2)).toEqual([])

    // c joins a's exact instance: BOTH consumers now see exactly one hot
    // instance, and it is the same instance id.
    const cMoved = vrcFriend('c', 'in-game', pyramid('wrld_fish:aaa~public'))
    engine.consume(event(cMoved))

    const hot = alerts.filter((x): x is HotInstanceAlert => x.type === 'hot-instance')
    expect(hot).toHaveLength(1)
    expect(hot[0]!.instanceId).toBe('wrld_fish:aaa~public')

    const cards = getHotInstances([a, b, cMoved], 2)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.instanceId).toBe(hot[0]!.instanceId)
    expect(cards[0]!.members.map((m) => m.platformUserId)).toEqual(['a', 'c'])
  })
})
