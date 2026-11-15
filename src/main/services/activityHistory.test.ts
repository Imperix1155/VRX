import { describe, expect, it } from 'vitest'
import type { ActivityEntry, ActivityKeepFor } from '@shared/activity'
import type { AdapterEvent, Platform, VrcFriend } from '@shared/types'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM, ACTIVITY_PAGE_SIZE } from '@shared/constants'
import { ActivityFeed } from './activityFeed'
import { ActivityHistory } from './activityHistory'
import { HistoryDatabase } from './historyDatabase'

const DAY_MS = 86_400_000

function friend(
  platformUserId: string,
  state: VrcFriend['presence']['state'],
  displayName = platformUserId
): VrcFriend {
  return {
    platformUserId,
    platform: 'vrchat',
    displayName,
    avatarUrl: null,
    presence: { state },
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null
  }
}

function presence(value: VrcFriend): AdapterEvent {
  return { type: 'friend-presence', platform: 'vrchat', friend: value }
}

function entry(id: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id,
    kind: 'online',
    platform: 'vrchat',
    platformUserId: 'usr_a',
    displayName: 'Alice',
    worldName: null,
    at: id,
    ...overrides
  }
}

interface World {
  database: HistoryDatabase
  history: ActivityHistory
  accounts: Partial<Record<Platform, string>>
  setKeepFor: (value: ActivityKeepFor) => void
  setNow: (value: number) => void
  /** A feed over the same saved copy, as a restart would build. */
  feed: () => ActivityFeed
}

function setup(keepFor: ActivityKeepFor = '90d'): World {
  let keep = keepFor
  let now = 100 * DAY_MS
  const accounts: Partial<Record<Platform, string>> = {
    vrchat: 'vrchat:usr_me',
    chilloutvr: 'chilloutvr:me-1'
  }
  const database = new HistoryDatabase({ path: null })
  const history = new ActivityHistory({
    database,
    accountKeyFor: (platform) => accounts[platform] ?? null,
    keepFor: () => keep,
    now: () => now
  })
  return {
    database,
    history,
    accounts,
    setKeepFor: (value) => {
      keep = value
    },
    setNow: (value) => {
      now = value
    },
    feed: () =>
      new ActivityFeed({
        now: () => now,
        clock: () => now,
        isEnabled: () => true,
        resolveName: () => null,
        onChanged: () => undefined,
        store: history
      })
  }
}

/** The roster the feed learns silently, everyone offline. */
function seed(feed: ActivityFeed, ids: string[]): void {
  feed.seedRoster(
    'vrchat',
    ids.map((id) => friend(id, 'offline'))
  )
}

/** One seeded friend comes online: one entry. */
function comeOnline(feed: ActivityFeed, id: string): void {
  feed.consume(presence(friend(id, 'active')))
}

describe('ActivityHistory', () => {
  it('saves under the signed-in account and reads only that account back', () => {
    const { history, accounts } = setup()
    history.append(entry(1))
    history.append(entry(2, { platform: 'chilloutvr', platformUserId: 'friend-1' }))

    expect(history.recent('vrchat', 10).map((item) => item.id)).toEqual([1])
    expect(history.recent('chilloutvr', 10).map((item) => item.id)).toEqual([2])

    // Another account on the same platform sees none of it.
    accounts.vrchat = 'vrchat:usr_other'
    expect(history.recent('vrchat', 10)).toEqual([])
    expect(
      history.page({ scope: [{ platform: 'vrchat', beforeId: null }], filter: 'all' }, 10)
    ).toEqual([])

    // Signed out: nothing is read and nothing is saved.
    delete accounts.vrchat
    history.append(entry(3))
    expect(history.recent('vrchat', 10)).toEqual([])
    accounts.vrchat = 'vrchat:usr_me'
    expect(history.recent('vrchat', 10).map((item) => item.id)).toEqual([1])
  })

  it("reads a friend only under the account of the friend's own platform", () => {
    const { history } = setup()
    history.append(entry(1, { platformUserId: 'same-id' }))
    history.append(entry(2, { platform: 'chilloutvr', platformUserId: 'same-id' }))
    history.append(entry(3, { platformUserId: 'usr_b' }))

    const page = (friends: Array<{ platform: Platform; friendId: string }>): number[] =>
      (
        history.page(
          {
            scope: [
              { platform: 'vrchat', beforeId: null },
              { platform: 'chilloutvr', beforeId: null }
            ],
            filter: 'all',
            friends
          },
          10
        ) ?? []
      ).map((item) => item.id)

    expect(page([{ platform: 'vrchat', friendId: 'same-id' }])).toEqual([1])
    expect(
      page([
        { platform: 'vrchat', friendId: 'same-id' },
        { platform: 'chilloutvr', friendId: 'same-id' }
      ])
    ).toEqual([2, 1])
    // A friend on a platform that is out of scope is not read.
    expect(
      (
        history.page(
          {
            scope: [{ platform: 'vrchat', beforeId: null }],
            filter: 'all',
            friends: [{ platform: 'chilloutvr', friendId: 'same-id' }]
          },
          10
        ) ?? []
      ).map((item) => item.id)
    ).toEqual([])
  })

  it('saves nothing on "until VRX closes" and removes what was saved', () => {
    const { history, setKeepFor, database } = setup('session')
    history.append(entry(1))
    expect(database.maxActivityId()).toBe(0)
    expect(
      history.page({ scope: [{ platform: 'vrchat', beforeId: null }], filter: 'all' }, 10)
    ).toBeNull()

    setKeepFor('30d')
    history.append(entry(2))
    expect(history.recent('vrchat', 10).map((item) => item.id)).toEqual([2])

    setKeepFor('session')
    history.prune()
    expect(database.maxActivityId()).toBe(0)
    expect(history.recent('vrchat', 10)).toEqual([])
  })

  it('removes what is older than the setting keeps', () => {
    const { history, setKeepFor, setNow } = setup('forever')
    history.append(entry(1, { at: 1 * DAY_MS }))
    history.append(entry(2, { at: 60 * DAY_MS }))
    history.append(entry(3, { at: 95 * DAY_MS }))
    setNow(100 * DAY_MS)
    const ids = (): number[] => history.recent('vrchat', 10).map((item) => item.id)

    history.prune()
    expect(ids()).toEqual([3, 2, 1])
    setKeepFor('1y')
    history.prune()
    expect(ids()).toEqual([3, 2, 1])
    setKeepFor('90d')
    history.prune()
    expect(ids()).toEqual([3, 2])
    setKeepFor('30d')
    history.prune()
    expect(ids()).toEqual([3])
  })
})

describe('ActivityFeed with a saved copy', () => {
  it("brings an account's list back after a restart, with ids that keep increasing", () => {
    const world = setup()
    const first = world.feed()
    seed(first, ['usr_a', 'usr_b'])
    comeOnline(first, 'usr_a')
    comeOnline(first, 'usr_b')
    const before = first.list()
    expect(before).toHaveLength(2)

    const second = world.feed()
    expect(second.list()).toEqual([])
    second.hydrate('vrchat')
    expect(second.list()).toEqual(before)
    // Hydrating again adds nothing twice.
    second.hydrate('vrchat')
    expect(second.list()).toEqual(before)

    seed(second, ['usr_c'])
    comeOnline(second, 'usr_c')
    const newest = second.list()[0]
    expect(newest?.platformUserId).toBe('usr_c')
    expect(newest?.id).toBeGreaterThan(Math.max(...before.map((item) => item.id)))
  })

  it('starts over from the saved copy after it was replaced, never reusing an id', () => {
    const world = setup()
    const feed = world.feed()
    seed(feed, ['usr_a'])
    comeOnline(feed, 'usr_a')
    const before = Math.max(...feed.list().map((item) => item.id))

    // A restored backup: other rows, one with a higher id than any given out.
    world.database.deleteAllActivity()
    world.database.insertActivity({
      id: before + 40,
      accountKey: 'vrchat:usr_me',
      kind: 'offline',
      platformUserId: 'usr_r',
      displayName: 'Restored',
      worldName: null,
      previousName: null,
      at: 5
    })
    feed.reload()
    expect(feed.list().map((item) => item.displayName)).toEqual(['Restored'])

    seed(feed, ['usr_c'])
    comeOnline(feed, 'usr_c')
    expect(feed.list()[0]?.id).toBe(before + 41)
  })

  it('drops the outgoing account from memory and shows the next account only its own', () => {
    const world = setup()
    const feed = world.feed()
    seed(feed, ['usr_a'])
    comeOnline(feed, 'usr_a')
    expect(feed.list()).toHaveLength(1)

    feed.resetPlatform('vrchat')
    expect(feed.list()).toEqual([])
    world.accounts.vrchat = 'vrchat:usr_other'
    feed.hydrate('vrchat')
    expect(feed.list()).toEqual([])
    seed(feed, ['usr_z'])
    comeOnline(feed, 'usr_z')
    expect(feed.list().map((item) => item.platformUserId)).toEqual(['usr_z'])

    feed.resetPlatform('vrchat')
    world.accounts.vrchat = 'vrchat:usr_me'
    feed.hydrate('vrchat')
    expect(feed.list().map((item) => item.platformUserId)).toEqual(['usr_a'])
  })

  it("pages older entries than memory holds, and one friend's entries", () => {
    const world = setup()
    const feed = world.feed()
    const total = ACTIVITY_MAX_ENTRIES_PER_PLATFORM + ACTIVITY_PAGE_SIZE + 5
    const ids = Array.from({ length: total }, (_, index) => `usr_${index}`)
    seed(feed, ids)
    for (const id of ids) comeOnline(feed, id)
    const live = feed.list()
    expect(live).toHaveLength(ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    const oldestLive = Math.min(...live.map((item) => item.id))

    const older = feed.page({
      scope: [{ platform: 'vrchat', beforeId: oldestLive }],
      filter: 'all'
    })
    expect(older.entries).toHaveLength(ACTIVITY_PAGE_SIZE)
    expect(older.hasMore).toBe(true)
    expect(Math.max(...older.entries.map((item) => item.id))).toBeLessThan(oldestLive)

    const last = feed.page({
      scope: [{ platform: 'vrchat', beforeId: Math.min(...older.entries.map((item) => item.id)) }],
      filter: 'all'
    })
    expect(last.entries).toHaveLength(5)
    expect(last.hasMore).toBe(false)

    const one = feed.page({
      scope: [
        { platform: 'vrchat', beforeId: null },
        { platform: 'chilloutvr', beforeId: null }
      ],
      filter: 'all',
      friends: [{ platform: 'vrchat', friendId: 'usr_0' }]
    })
    expect(one.entries.map((item) => item.platformUserId)).toEqual(['usr_0'])
    expect(one.hasMore).toBe(false)
  })

  it('pages from memory when nothing is saved', () => {
    const world = setup('session')
    const feed = world.feed()
    seed(feed, ['usr_a', 'usr_b'])
    comeOnline(feed, 'usr_a')
    comeOnline(feed, 'usr_b')
    feed.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })

    const page = feed.page({
      scope: [{ platform: 'vrchat', beforeId: null }],
      filter: 'all',
      friends: [{ platform: 'vrchat', friendId: 'usr_a' }]
    })
    expect(page.entries.map((item) => item.kind)).toEqual(['offline', 'online'])
    expect(page.hasMore).toBe(false)
    expect(
      feed.page({ scope: [{ platform: 'vrchat', beforeId: null }], filter: 'offline' }).entries
    ).toHaveLength(1)
    expect(
      feed.page({ scope: [{ platform: 'chilloutvr', beforeId: null }], filter: 'all' }).entries
    ).toEqual([])
  })

  it('saves what the list holds when saving is turned on', () => {
    const world = setup('session')
    const feed = world.feed()
    seed(feed, ['usr_a'])
    comeOnline(feed, 'usr_a')
    expect(feed.list()).toHaveLength(1)
    expect(world.database.maxActivityId()).toBe(0)

    world.setKeepFor('90d')
    feed.saveAll()
    feed.saveAll()
    expect(world.history.recent('vrchat', 10).map((item) => item.platformUserId)).toEqual(['usr_a'])
  })

  it('clears saved entries too: the shown kind, or everything when turned off', () => {
    const world = setup()
    const feed = world.feed()
    seed(feed, ['usr_a'])
    comeOnline(feed, 'usr_a')
    feed.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })
    expect(world.history.recent('vrchat', 10).map((item) => item.kind)).toEqual([
      'offline',
      'online'
    ])

    // A fresh run holds nothing in memory, and Clear still reaches the file.
    const restarted = world.feed()
    restarted.clear(['vrchat'], 'offline')
    expect(world.history.recent('vrchat', 10).map((item) => item.kind)).toEqual(['online'])

    // What stays saved moves up into the list.
    expect(restarted.list().map((item) => item.kind)).toEqual(['online'])

    restarted.clearAll()
    expect(restarted.list()).toEqual([])
    expect(world.history.recent('vrchat', 10)).toEqual([])
    expect(world.database.maxActivityId()).toBe(0)
  })

  it("never saves a hidden friend's world", () => {
    const world = setup()
    const feed = world.feed()
    seed(feed, ['usr_a'])
    feed.consume(
      presence({
        ...friend('usr_a', 'in-game'),
        status: 'ask-me',
        instance: {
          worldId: 'wrld_1',
          instanceId: '100',
          worldName: 'Private Room',
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
      })
    )

    const saved = world.history.recent('vrchat', 10)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.worldName).toBeNull()
  })
})
