import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, CvrFriend, Friend, InstanceInfo, VrcFriend } from '@shared/types'
import type { ActivityEntry } from '@shared/activity'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM } from '@shared/constants'
import { ActivityFeed } from './activityFeed'

function instance(
  worldId: string,
  instanceId: string,
  worldName: string | null = 'The Great Pug'
): InstanceInfo {
  return {
    worldId,
    instanceId,
    worldName,
    thumbnailUrl: null,
    type: 'public',
    openness: 'public',
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: null,
    userCount: null
  }
}

function vrcFriend(
  state: Friend['presence']['state'],
  currentInstance: InstanceInfo | null = null,
  platformUserId = 'usr_a',
  status: VrcFriend['status'] = 'online',
  displayName = 'Alice'
): VrcFriend {
  return {
    platformUserId,
    platform: 'vrchat',
    displayName,
    avatarUrl: null,
    presence: { state },
    instance: currentInstance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status,
    statusDescription: null,
    trustRank: null
  }
}

function cvrFriend(platformUserId: string, displayName: string): CvrFriend {
  return {
    platformUserId,
    platform: 'chilloutvr',
    displayName,
    avatarUrl: null,
    presence: { state: 'offline' },
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: null,
    statusDescription: null,
    trustRank: null
  }
}

function presence(friend: Friend): AdapterEvent {
  return { type: 'friend-presence', platform: friend.platform, friend }
}

function cvrSnapshot(
  entries: Array<{ platformUserId: string; instance: InstanceInfo | null }>
): AdapterEvent {
  return {
    type: 'presence-snapshot',
    platform: 'chilloutvr',
    entries: entries.map((entry) => ({ ...entry, presence: { state: 'in-game' as const } }))
  }
}

function setup(enabled = true): {
  feed: ActivityFeed
  onChanged: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
  setEnabled: (value: boolean) => void
} {
  let wall = 1_000_000
  let isOn = enabled
  const onChanged = vi.fn()
  const feed = new ActivityFeed({
    now: () => wall,
    clock: () => wall,
    isEnabled: () => isOn,
    resolveName: () => null,
    onChanged
  })
  return {
    feed,
    onChanged,
    advance: (ms) => {
      wall += ms
    },
    setEnabled: (value) => {
      isOn = value
    }
  }
}

describe('ActivityFeed', () => {
  it('records online into a world as one entry, then moves and going offline', () => {
    const { feed, advance } = setup()
    feed.seedRoster('vrchat', [vrcFriend('offline')])

    feed.consume(presence(vrcFriend('in-game', instance('wrld_1', '100', 'Pug Lounge'))))
    advance(1000)
    feed.consume(presence(vrcFriend('in-game', instance('wrld_2', '200', 'Night Market'))))
    advance(1000)
    feed.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })

    expect(
      feed.list().map(({ kind, worldName, displayName }) => [kind, worldName, displayName])
    ).toEqual([
      ['offline', null, 'Alice'],
      ['world', 'Night Market', 'Alice'],
      ['online', 'Pug Lounge', 'Alice']
    ])
    const [offline, world, online] = feed.list() as [ActivityEntry, ActivityEntry, ActivityEntry]
    expect(online.at).toBe(1_000_000)
    expect(world.at).toBe(1_001_000)
    expect(offline.at).toBe(1_002_000)
    expect(offline.id).toBeGreaterThan(world.id)
    // Main-only backfill keys never cross IPC.
    expect(Object.keys(online).sort()).toEqual(
      ['at', 'displayName', 'id', 'kind', 'platform', 'platformUserId', 'worldName'].sort()
    )
  })

  it('never records a world or a move for Ask Me and Do Not Disturb friends', () => {
    const { feed } = setup()
    feed.seedRoster('vrchat', [vrcFriend('offline', null, 'usr_a', 'ask-me')])

    feed.consume(presence(vrcFriend('in-game', instance('wrld_1', '100'), 'usr_a', 'ask-me')))
    feed.consume(presence(vrcFriend('in-game', instance('wrld_2', '200'), 'usr_a', 'dnd')))
    feed.consume({
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_1',
      worldName: 'Secret Room',
      thumbnailUrl: null
    })

    expect(feed.list().map(({ kind, worldName }) => [kind, worldName])).toEqual([['online', null]])
  })

  it('fills a VRChat world name that resolves shortly after, but not much later', () => {
    const { feed, advance, onChanged } = setup()
    feed.seedRoster('vrchat', [
      vrcFriend('offline', null, 'usr_a'),
      vrcFriend('offline', null, 'usr_b', 'online', 'Bob')
    ])
    feed.consume(presence(vrcFriend('in-game', instance('wrld_1', '100', null), 'usr_a')))
    onChanged.mockClear()

    feed.consume({
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_1',
      worldName: 'Pug Lounge',
      thumbnailUrl: null
    })
    expect(feed.list()[0]?.worldName).toBe('Pug Lounge')
    expect(onChanged).toHaveBeenCalledTimes(1)

    feed.consume(
      presence(vrcFriend('in-game', instance('wrld_9', '900', null), 'usr_b', 'online', 'Bob'))
    )
    advance(11 * 60_000)
    feed.consume({
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_9',
      worldName: 'Too Late',
      thumbnailUrl: null
    })
    expect(feed.list()[0]).toMatchObject({ displayName: 'Bob', worldName: null })
  })

  it('records ChilloutVR the same way and fills its world once resolved', () => {
    const { feed } = setup()
    feed.seedRoster('chilloutvr', [cvrFriend('cvr-1', 'Kai')])
    // The first snapshot is the baseline.
    feed.consume(cvrSnapshot([]))

    // Unresolved: the world id repeats the instance id and the name is the
    // instance's own label, which is never shown as a world.
    feed.consume(
      cvrSnapshot([{ platformUserId: 'cvr-1', instance: instance('i-1', 'i-1', 'Room (#42)') }])
    )
    expect(feed.list()).toMatchObject([
      { kind: 'online', platform: 'chilloutvr', displayName: 'Kai', worldName: null }
    ])

    feed.consume(
      cvrSnapshot([{ platformUserId: 'cvr-1', instance: instance('w-1', 'i-1', 'Sunset Bay') }])
    )
    expect(feed.list()).toMatchObject([{ kind: 'online', worldName: 'Sunset Bay' }])

    feed.consume(cvrSnapshot([]))
    expect(feed.list().map((entry) => entry.kind)).toEqual(['offline', 'online'])
  })

  it('keeps every transition in a burst, unlike the rate-limited toasts', () => {
    const { feed } = setup()
    const ids = Array.from({ length: 10 }, (_, i) => `usr_${i}`)
    feed.seedRoster(
      'vrchat',
      ids.map((id) => vrcFriend('offline', null, id))
    )
    for (const id of ids) feed.consume(presence(vrcFriend('active', null, id)))
    expect(feed.list()).toHaveLength(10)
  })

  it('records nothing while turned off, and picks up cleanly when turned back on', () => {
    const { feed, onChanged, setEnabled } = setup(false)
    feed.seedRoster('vrchat', [vrcFriend('offline')])
    feed.consume(presence(vrcFriend('active')))
    expect(feed.list()).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()

    setEnabled(true)
    feed.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })
    expect(feed.list().map((entry) => entry.kind)).toEqual(['offline'])
  })

  it('forgets a platform at an account boundary but keeps it for the same account', () => {
    const { feed, onChanged } = setup()
    feed.seedRoster('vrchat', [vrcFriend('offline')])
    feed.seedRoster('chilloutvr', [cvrFriend('cvr-1', 'Kai')])
    feed.consume(presence(vrcFriend('active')))
    feed.consume(cvrSnapshot([]))
    feed.consume(cvrSnapshot([{ platformUserId: 'cvr-1', instance: null }]))
    expect(feed.list()).toHaveLength(2)

    onChanged.mockClear()
    feed.resetPlatform('vrchat', { keepEntries: true })
    expect(feed.list()).toHaveLength(2)
    expect(onChanged).not.toHaveBeenCalled()

    feed.resetPlatform('vrchat')
    expect(feed.list().map((entry) => entry.platform)).toEqual(['chilloutvr'])
    expect(onChanged).toHaveBeenCalledTimes(1)

    feed.clearAll()
    expect(feed.list()).toEqual([])
    expect(onChanged).toHaveBeenCalledTimes(2)
    feed.clearAll()
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('caps each platform separately so one never pushes the other out', () => {
    const { feed } = setup()
    feed.seedRoster('chilloutvr', [cvrFriend('cvr-1', 'Kai')])
    feed.consume(cvrSnapshot([]))
    feed.consume(cvrSnapshot([{ platformUserId: 'cvr-1', instance: null }]))
    feed.seedRoster('vrchat', [vrcFriend('offline')])
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES_PER_PLATFORM + 20; i++) {
      feed.consume(presence(vrcFriend('active')))
      feed.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })
    }
    const entries = feed.list()
    expect(entries.filter((entry) => entry.platform === 'vrchat')).toHaveLength(
      ACTIVITY_MAX_ENTRIES_PER_PLATFORM
    )
    expect(entries.filter((entry) => entry.platform === 'chilloutvr')).toHaveLength(1)
  })

  it('does not announce changes for events that record nothing', () => {
    const { feed, onChanged } = setup()
    feed.seedRoster('vrchat', [vrcFriend('active')])
    feed.consume(presence(vrcFriend('active')))
    feed.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    feed.consume({ type: 'roster-changed', platform: 'chilloutvr' })
    expect(onChanged).not.toHaveBeenCalled()
  })
})
