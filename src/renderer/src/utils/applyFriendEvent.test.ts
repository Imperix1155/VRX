/**
 * applyFriendEvent tests (VRX-146) — pins the live-cache semantics: upsert vs
 * patch vs merge, reference behavior (unchanged entries keep identity for the
 * memo'd rows), and the snapshot scopes.
 */
import { describe, expect, it } from 'vitest'
import type { Friend, VrcFriend } from '@shared/types'
import { applyFriendEvent } from './applyFriendEvent'

function friend(overrides: Partial<VrcFriend> = {}): Friend {
  const base: VrcFriend = {
    platform: 'vrchat',
    platformUserId: 'usr_1',
    displayName: 'Alice',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    trustRank: 'known',
    instance: {
      worldId: 'wrld_a',
      worldName: 'The Pug',
      instanceId: 'i1',
      type: 'public',
      openness: 'public',
      isGroup: false,
      region: 'us',
      thumbnailUrl: null,
      groupName: null,
      userCount: null
    },
    isFavorite: true,
    favoriteGroupIds: ['grp_fav'],
    linkedPersonId: 'person_1'
  }
  return { ...base, ...overrides }
}

describe('applyFriendEvent', () => {
  it('friend-presence upserts: replaces an existing entry, appends a new one', () => {
    const existing = friend()
    const updated = friend({ presence: { state: 'active' }, instance: null })
    const next = applyFriendEvent([existing], {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: updated
    })
    expect(next).toHaveLength(1)
    expect(next[0]!.presence.state).toBe('active')

    const stranger = friend({ platformUserId: 'usr_9', displayName: 'Nine' })
    const appended = applyFriendEvent([existing], {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: stranger
    })
    expect(appended).toHaveLength(2)
  })

  it('friend-offline patches state and clears pill/instance but keeps the profile', () => {
    const next = applyFriendEvent([friend()], {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_1'
    })
    expect(next[0]).toMatchObject({
      displayName: 'Alice',
      trustRank: 'known',
      presence: { state: 'offline' },
      status: null,
      instance: null
    })
  })

  it('friend-offline for an unknown id changes nothing (reconcile catches up)', () => {
    const list = [friend()]
    const next = applyFriendEvent(list, {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_unknown'
    })
    expect(next[0]).toBe(list[0]) // untouched entries keep identity
  })

  it('friend-updated merges profile fields but PRESERVES presence, instance, and local state', () => {
    const incoming = friend({
      displayName: 'Alice Renamed',
      status: 'ask-me',
      // The wire built this with offline/null — must not leak into the cache:
      presence: { state: 'offline' },
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
    const next = applyFriendEvent([friend()], {
      type: 'friend-updated',
      platform: 'vrchat',
      friend: incoming
    })
    expect(next[0]).toMatchObject({
      displayName: 'Alice Renamed', // profile merged
      status: 'ask-me',
      presence: { state: 'in-game' }, // preserved
      isFavorite: true, // local state preserved
      linkedPersonId: 'person_1'
    })
    expect(next[0]!.instance).not.toBeNull() // preserved
  })

  it('friend-removed filters the entry out', () => {
    const next = applyFriendEvent([friend(), friend({ platformUserId: 'usr_2' })], {
      type: 'friend-removed',
      platform: 'vrchat',
      platformUserId: 'usr_1'
    })
    expect(next).toHaveLength(1)
    expect(next[0]!.platformUserId).toBe('usr_2')
  })

  it("friends-snapshot scope 'all' replaces the list wholesale", () => {
    const replacement = [friend({ platformUserId: 'usr_9' })]
    const next = applyFriendEvent([friend()], {
      type: 'friends-snapshot',
      platform: 'vrchat',
      scope: 'all',
      friends: replacement
    })
    expect(next).toBe(replacement)
  })

  it("friends-snapshot scope 'online' flips absent friends offline and upserts members", () => {
    const stays = friend({ platformUserId: 'usr_on' })
    const goesOffline = friend({ platformUserId: 'usr_off' })
    const next = applyFriendEvent([stays, goesOffline], {
      type: 'friends-snapshot',
      platform: 'vrchat',
      scope: 'online',
      friends: [friend({ platformUserId: 'usr_on', presence: { state: 'active' }, instance: null })]
    })
    const off = next.find((f) => f.platformUserId === 'usr_off')
    const on = next.find((f) => f.platformUserId === 'usr_on')
    expect(off).toMatchObject({ presence: { state: 'offline' }, instance: null })
    expect(on).toMatchObject({ presence: { state: 'active' } })
  })

  it('connection events change nothing (list identity preserved)', () => {
    const list = [friend()]
    expect(applyFriendEvent(list, { type: 'connection', platform: 'vrchat', health: 'live' })).toBe(
      list
    )
  })

  it('never mutates the input list or its entries', () => {
    const original = friend()
    const list = [original]
    applyFriendEvent(list, {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_1'
    })
    expect(original.presence.state).toBe('in-game') // untouched
    expect(list).toHaveLength(1)
  })
})
