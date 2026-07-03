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

  it('presence-snapshot patches listed ids and flips absent same-platform friends offline (VRX-147)', () => {
    const cvr = (id: string, state: 'in-game' | 'offline' = 'in-game'): Friend => ({
      platform: 'chilloutvr',
      platformUserId: id,
      displayName: id,
      avatarUrl: null,
      presence: { state },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
    const vrcFriend = friend() // different platform — must be untouched

    const next = applyFriendEvent([cvr('cvr_stays'), cvr('cvr_leaves'), vrcFriend], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_stays',
          presence: { state: 'in-game' },
          instance: {
            worldId: 'i_1',
            instanceId: 'i_1',
            worldName: 'Lounge',
            thumbnailUrl: null,
            type: 'friends',
            openness: 'friends',
            isGroup: false,
            groupName: null,
            region: null,
            userCount: null
          }
        }
      ]
    })

    expect(next.find((f) => f.platformUserId === 'cvr_stays')).toMatchObject({
      presence: { state: 'in-game' },
      instance: { worldName: 'Lounge' },
      displayName: 'cvr_stays' // profile untouched — the wire has no profiles
    })
    expect(next.find((f) => f.platformUserId === 'cvr_leaves')).toMatchObject({
      presence: { state: 'offline' },
      instance: null
    })
    expect(next.find((f) => f.platform === 'vrchat')).toBe(vrcFriend) // other platform: identity kept
  })

  it('presence-snapshot keeps identity for listed entries whose presence+instance are unchanged', () => {
    const inst = {
      worldId: 'i_1',
      instanceId: 'i_1',
      worldName: 'Lounge',
      thumbnailUrl: null,
      type: 'friends',
      openness: 'friends',
      isGroup: false,
      groupName: null,
      region: null,
      userCount: null
    }
    const cvrInGame = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_same',
      displayName: 'same',
      avatarUrl: null,
      presence: { state: 'in-game' },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: inst,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    } as Friend
    // The wire re-pushes the same state with a FRESHLY ALLOCATED instance.
    const next = applyFriendEvent([cvrInGame], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_same',
          presence: { state: 'in-game' },
          instance: { ...inst } as never
        }
      ]
    })
    expect(next[0]).toBe(cvrInGame) // no churn — memo'd row skips
  })

  it('presence-snapshot DOES update when only a volatile field differs (userCount)', () => {
    const inst = {
      worldId: 'i_1',
      instanceId: 'i_1',
      worldName: 'Lounge',
      thumbnailUrl: null,
      type: 'friends',
      openness: 'friends',
      isGroup: false,
      groupName: null,
      region: null,
      userCount: 4
    }
    const cached = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_count',
      displayName: 'count',
      avatarUrl: null,
      presence: { state: 'in-game' },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: inst,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    } as Friend
    const next = applyFriendEvent([cached], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_count',
          presence: { state: 'in-game' },
          instance: { ...inst, userCount: 5 } as never
        }
      ]
    })
    expect(next[0]).not.toBe(cached) // fresh data must not be dropped as "same"
    expect(next[0]!.instance!.userCount).toBe(5)
  })

  it('presence-snapshot leaves already-offline absentees with their identity (no churn)', () => {
    const cvrOffline = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_off',
      displayName: 'off',
      avatarUrl: null,
      presence: { state: 'offline' },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    } as Friend
    const next = applyFriendEvent([cvrOffline], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: []
    })
    expect(next[0]).toBe(cvrOffline)
  })

  it('roster-changed changes nothing at the list level (hook refetches)', () => {
    const list = [friend()]
    expect(applyFriendEvent(list, { type: 'roster-changed', platform: 'chilloutvr' })).toBe(list)
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
