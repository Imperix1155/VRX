import { describe, expect, it, vi } from 'vitest'
import type { ActivityKeepFor } from '@shared/activity'
import type { Friend, Platform, VrcFriend } from '@shared/types'
import { FriendHistory } from './activityHistory'
import { FriendLog, type FriendListChange } from './friendLog'
import { HistoryDatabase } from './historyDatabase'

function friend(platformUserId: string, displayName = platformUserId): VrcFriend {
  return {
    platformUserId,
    platform: 'vrchat',
    displayName,
    avatarUrl: null,
    presence: { state: 'offline' },
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null
  }
}

interface World {
  database: HistoryDatabase
  accounts: Partial<Record<Platform, string>>
  changes: FriendListChange[]
  setKeepFor: (value: ActivityKeepFor) => void
  setEnabled: (value: boolean) => void
  setNow: (value: number) => void
  /** A log over the same saved copy, as a restart would build. */
  log: () => FriendLog
}

function setup(keepFor: ActivityKeepFor = '90d'): World {
  let keep = keepFor
  let enabled = true
  let now = 1_000
  const accounts: Partial<Record<Platform, string>> = {
    vrchat: 'vrchat:usr_me',
    chilloutvr: 'chilloutvr:me-1'
  }
  const database = new HistoryDatabase({ path: null })
  const changes: FriendListChange[] = []
  return {
    database,
    accounts,
    changes,
    setKeepFor: (value) => {
      keep = value
    },
    setEnabled: (value) => {
      enabled = value
    },
    setNow: (value) => {
      now = value
    },
    log: () =>
      new FriendLog({
        now: () => now,
        isEnabled: () => enabled,
        record: (change) => changes.push(change),
        store: new FriendHistory({
          database,
          accountKeyFor: (platform) => accounts[platform] ?? null,
          keepFor: () => keep
        })
      })
  }
}

const roster = (...friends: Friend[]): Friend[] => friends

describe('FriendLog', () => {
  it('takes the first whole list as the starting point and reports nothing', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice'), friend('usr_b', 'Bob')), 'complete')

    expect(world.changes).toEqual([])
    expect(log.facts('vrchat', 'usr_a')).toEqual({
      platform: 'vrchat',
      friendId: 'usr_a',
      since: 1_000,
      sinceKnown: false,
      previousNames: []
    })
  })

  it('never starts from a partial or empty list', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a')), 'partial')
    log.rosterRead('vrchat', [], 'complete')
    log.rosterRead('vrchat', roster(friend('usr_a'), friend('usr_b')), 'complete')

    expect(world.changes).toEqual([])
    expect(log.facts('vrchat', 'usr_b').sinceKnown).toBe(false)
  })

  it('reports a new friend from a later list, with the day it was seen', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a')), 'complete')
    world.setNow(5_000)
    log.rosterRead('vrchat', roster(friend('usr_a'), friend('usr_b', 'Bob')), 'partial')

    expect(world.changes).toEqual([
      { kind: 'added', platform: 'vrchat', platformUserId: 'usr_b', displayName: 'Bob' }
    ])
    expect(log.facts('vrchat', 'usr_b')).toMatchObject({ since: 5_000, sinceKnown: true })
    // Seen again: nothing new.
    log.rosterRead('vrchat', roster(friend('usr_a'), friend('usr_b', 'Bob')), 'complete')
    expect(world.changes).toHaveLength(1)
  })

  it('reports a new friend from the live event, and only that event adds one', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a')), 'complete')
    log.consume({ type: 'friend-updated', platform: 'vrchat', friend: friend('usr_c', 'Cy') })
    log.consume({ type: 'friend-presence', platform: 'vrchat', friend: friend('usr_c', 'Cy') })
    expect(world.changes).toEqual([])

    log.consume({ type: 'friend-added', platform: 'vrchat', friend: friend('usr_c', 'Cy') })
    expect(world.changes.map((change) => change.kind)).toEqual(['added'])
  })

  it('keeps the name a friend had before, newest change first', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    world.setNow(2_000)
    log.consume({ type: 'friend-updated', platform: 'vrchat', friend: friend('usr_a', 'Alicia') })
    world.setNow(3_000)
    log.rosterRead('vrchat', roster(friend('usr_a', 'Ali')), 'complete')

    expect(world.changes).toEqual([
      {
        kind: 'renamed',
        platform: 'vrchat',
        platformUserId: 'usr_a',
        displayName: 'Alicia',
        previousName: 'Alice'
      },
      {
        kind: 'renamed',
        platform: 'vrchat',
        platformUserId: 'usr_a',
        displayName: 'Ali',
        previousName: 'Alicia'
      }
    ])
    expect(log.facts('vrchat', 'usr_a').previousNames).toEqual([
      { name: 'Alicia', until: 3_000 },
      { name: 'Alice', until: 2_000 }
    ])
  })

  it('never reads a row without a name as a rename', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    log.rosterRead('vrchat', roster(friend('usr_a', '  ')), 'partial')
    log.consume({ type: 'friend-updated', platform: 'vrchat', friend: friend('usr_a', '') })

    expect(world.changes).toEqual([])
    expect(log.facts('vrchat', 'usr_a').previousNames).toEqual([])
  })

  it('counts a friend as gone only after two whole lists without them', () => {
    const world = setup()
    const log = world.log()
    const everyone = roster(friend('usr_a', 'Alice'), friend('usr_b', 'Bob'))
    log.rosterRead('vrchat', everyone, 'complete')

    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'partial')
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'partial')
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.changes).toEqual([])

    // Back on the list: the count starts over.
    log.rosterRead('vrchat', everyone, 'complete')
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.changes).toEqual([])

    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.changes).toEqual([
      { kind: 'removed', platform: 'vrchat', platformUserId: 'usr_b', displayName: 'Bob' }
    ])
    expect(log.facts('vrchat', 'usr_b').since).toBeNull()
  })

  it('counts a missing friend across a restart', () => {
    const world = setup()
    world
      .log()
      .rosterRead('vrchat', roster(friend('usr_a', 'Alice'), friend('usr_b', 'Bob')), 'complete')
    world.log().rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.changes).toEqual([])
    world.log().rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')

    expect(world.changes.map((change) => change.kind)).toEqual(['removed'])
  })

  it('takes the live removal at once', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    log.consume({ type: 'friend-removed', platform: 'vrchat', platformUserId: 'usr_a' })
    log.consume({ type: 'friend-removed', platform: 'vrchat', platformUserId: 'usr_a' })

    expect(world.changes).toEqual([
      { kind: 'removed', platform: 'vrchat', platformUserId: 'usr_a', displayName: 'Alice' }
    ])
  })

  it('remembers the list and "friends since" after a restart', () => {
    const world = setup()
    const first = world.log()
    first.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    world.setNow(7_000)
    first.consume({ type: 'friend-added', platform: 'vrchat', friend: friend('usr_b', 'Bob') })

    world.setNow(9_000)
    const second = world.log()
    expect(second.facts('vrchat', 'usr_b')).toMatchObject({ since: 7_000, sinceKnown: true })
    // A friend made while VRX was closed is new on the first list after.
    second.rosterRead(
      'vrchat',
      roster(friend('usr_a', 'Alice'), friend('usr_b', 'Bob'), friend('usr_c', 'Cy')),
      'complete'
    )
    expect(world.changes.map((change) => `${change.kind}:${change.platformUserId}`)).toEqual([
      'added:usr_b',
      'added:usr_c'
    ])
    expect(second.facts('vrchat', 'usr_a')).toMatchObject({ since: 1_000, sinceKnown: false })
  })

  it('keeps each account and each platform to its own list', () => {
    const world = setup()
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    log.rosterRead(
      'chilloutvr',
      roster({
        ...friend('id-1', 'Cat'),
        platform: 'chilloutvr',
        presence: { state: 'offline' },
        status: null,
        statusDescription: null,
        trustRank: null
      }),
      'complete'
    )

    // Another account signs in on VRChat: its first list is its own start.
    log.resetPlatform('vrchat')
    world.accounts.vrchat = 'vrchat:usr_other'
    log.rosterRead('vrchat', roster(friend('usr_z', 'Zed')), 'complete')
    expect(world.changes).toEqual([])
    expect(log.facts('vrchat', 'usr_a').since).toBeNull()

    // Back to the first account: its saved list is still there.
    log.resetPlatform('vrchat')
    world.accounts.vrchat = 'vrchat:usr_me'
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.changes).toEqual([])
    expect(log.facts('vrchat', 'usr_a').since).toBe(1_000)
    expect(log.facts('chilloutvr', 'id-1').since).toBe(1_000)
  })

  it('finds the saved list once the account is known', () => {
    const world = setup()
    world.log().rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')

    const log = world.log()
    delete world.accounts.vrchat
    log.consume({ type: 'friend-removed', platform: 'vrchat', platformUserId: 'usr_x' })
    world.accounts.vrchat = 'vrchat:usr_me'
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice'), friend('usr_b', 'Bob')), 'complete')

    expect(world.changes.map((change) => change.kind)).toEqual(['added'])
  })

  it('saves nothing while activity is kept only until VRX closes', () => {
    const world = setup('session')
    const log = world.log()
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    log.consume({ type: 'friend-added', platform: 'vrchat', friend: friend('usr_b', 'Bob') })
    expect(world.changes.map((change) => change.kind)).toEqual(['added'])
    expect(world.database.savedFriends('vrchat:usr_me')).toEqual([])

    // Saving comes on: what is known now is saved.
    world.setKeepFor('forever')
    log.saveAll()
    expect(
      world.database
        .savedFriends('vrchat:usr_me')
        .map((saved) => saved.platformUserId)
        .sort()
    ).toEqual(['usr_a', 'usr_b'])
  })

  it('does nothing while the Activity page is off, and forgets everything on request', () => {
    const world = setup()
    const log = world.log()
    world.setEnabled(false)
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    expect(world.database.savedFriends('vrchat:usr_me')).toEqual([])

    world.setEnabled(true)
    log.rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    log.consume({ type: 'friend-updated', platform: 'vrchat', friend: friend('usr_a', 'Al') })
    log.clearAll()
    expect(world.database.savedFriends('vrchat:usr_me')).toEqual([])
    expect(log.facts('vrchat', 'usr_a')).toMatchObject({ since: null, previousNames: [] })
  })

  it('removes the saved lists when saving is turned off', () => {
    const world = setup()
    world.log().rosterRead('vrchat', roster(friend('usr_a', 'Alice')), 'complete')
    const history = new FriendHistory({
      database: world.database,
      accountKeyFor: () => 'vrchat:usr_me',
      keepFor: () => 'session'
    })
    history.prune()
    expect(world.database.savedFriends('vrchat:usr_me')).toEqual([])
  })

  it('never throws into its caller when the record step fails', () => {
    const log = new FriendLog({
      now: () => 1,
      isEnabled: () => true,
      record: vi.fn()
    })
    log.rosterRead('vrchat', roster(friend('usr_a')), 'complete')
    expect(() =>
      log.consume({ type: 'friend-added', platform: 'vrchat', friend: friend('usr_b') })
    ).not.toThrow()
    expect(log.facts('vrchat', 'usr_b').sinceKnown).toBe(true)
  })
})
