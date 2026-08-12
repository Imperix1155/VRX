/**
 * applyFriendEvent tests (VRX-146) — pins the live-cache semantics: upsert vs
 * patch vs merge, reference behavior (unchanged entries keep identity for the
 * memo'd rows), and the snapshot scopes.
 */
import { describe, expect, it } from 'vitest'
import type { CvrFriend, Friend, VrcFriend } from '@shared/types'
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
      groupId: null,
      groupImageUrl: null,
      userCount: null
    },
    isFavorite: true,
    favoriteGroupIds: ['grp_fav'],
    linkedPersonId: 'person_1'
  }
  return { ...base, ...overrides }
}

describe('applyFriendEvent', () => {
  it('group-metadata patches groupName and groupImageUrl on the current same-group friend', () => {
    const target = friend({
      platformUserId: 'usr_target',
      instance: {
        ...friend().instance!,
        type: 'group',
        openness: 'invite',
        isGroup: true,
        groupId: 'grp_1',
        groupName: null,
        groupImageUrl: null
      }
    })
    const otherGroup = friend({
      platformUserId: 'usr_other',
      instance: {
        ...friend().instance!,
        type: 'group',
        openness: 'invite',
        isGroup: true,
        groupId: 'grp_2',
        groupName: null,
        groupImageUrl: null
      }
    })

    const next = applyFriendEvent([target, otherGroup], {
      type: 'group-metadata',
      platform: 'vrchat',
      groupId: 'grp_1',
      groupName: 'Pixel Pals',
      groupImageUrl: 'https://example.com/pals.png'
    })

    expect(next[0]).toMatchObject({
      platformUserId: 'usr_target',
      instance: {
        groupId: 'grp_1',
        groupName: 'Pixel Pals',
        groupImageUrl: 'https://example.com/pals.png'
      }
    })
    expect(next[1]).toBe(otherGroup)
  })

  it('group-metadata does not resurrect an offline friend', () => {
    const offline = friend({ platformUserId: 'usr_offline', instance: null })
    const next = applyFriendEvent([offline], {
      type: 'group-metadata',
      platform: 'vrchat',
      groupId: 'grp_1',
      groupName: 'Pixel Pals',
      groupImageUrl: null
    })
    expect(next[0]).toBe(offline)
  })

  it('world-metadata does not resurrect an offline friend and patches another current same-world friend', () => {
    const target = friend({
      platformUserId: 'usr_target',
      instance: {
        ...friend().instance!,
        worldName: null,
        thumbnailUrl: null
      }
    })
    const sameWorld = friend({
      platformUserId: 'usr_same_world',
      instance: {
        ...friend().instance!,
        instanceId: 'i2',
        worldName: null,
        thumbnailUrl: null
      }
    })
    const afterOffline = applyFriendEvent([target, sameWorld], {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_target'
    })

    const next = applyFriendEvent(afterOffline, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_a',
      worldName: 'The Pug',
      thumbnailUrl: 'https://example.com/pug.jpg'
    })

    expect(next[0]).toBe(afterOffline[0])
    expect(next[0]).toMatchObject({
      platformUserId: 'usr_target',
      presence: { state: 'offline' },
      status: null,
      instance: null
    })
    expect(next[1]).toMatchObject({
      platformUserId: 'usr_same_world',
      presence: { state: 'in-game' },
      instance: {
        worldId: 'wrld_a',
        instanceId: 'i2',
        worldName: 'The Pug',
        thumbnailUrl: 'https://example.com/pug.jpg'
      }
    })
  })

  it('world-metadata does not revert a location move and patches another current same-world friend', () => {
    const target = friend({
      platformUserId: 'usr_target',
      instance: {
        ...friend().instance!,
        worldName: null,
        thumbnailUrl: null
      }
    })
    const sameWorld = friend({
      platformUserId: 'usr_same_world',
      instance: {
        ...friend().instance!,
        instanceId: 'i2',
        worldName: null,
        thumbnailUrl: null
      }
    })
    const moved = friend({
      platformUserId: 'usr_target',
      status: 'ask-me',
      instance: {
        ...friend().instance!,
        worldId: 'wrld_new',
        worldName: 'New World',
        instanceId: 'new-instance',
        thumbnailUrl: 'https://example.com/new.jpg'
      }
    })
    const afterMove = applyFriendEvent([target, sameWorld], {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: moved
    })

    const next = applyFriendEvent(afterMove, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_a',
      worldName: 'The Pug',
      thumbnailUrl: 'https://example.com/pug.jpg'
    })

    expect(next[0]).toBe(afterMove[0])
    expect(next[0]).toMatchObject({
      platformUserId: 'usr_target',
      status: 'ask-me',
      instance: {
        worldId: 'wrld_new',
        worldName: 'New World',
        instanceId: 'new-instance',
        thumbnailUrl: 'https://example.com/new.jpg'
      }
    })
    expect(next[1]!.instance).toMatchObject({
      worldId: 'wrld_a',
      instanceId: 'i2',
      worldName: 'The Pug',
      thumbnailUrl: 'https://example.com/pug.jpg'
    })
  })

  it('world-metadata for an unknown world preserves array and friend identity', () => {
    const cached = friend()
    const list = [cached]

    const next = applyFriendEvent(list, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_unknown',
      worldName: 'Unknown',
      thumbnailUrl: null
    })

    expect(next).toBe(list)
    expect(next[0]).toBe(cached)
  })

  it('world-metadata ignores a same-world friend on another platform', () => {
    const cached = {
      ...friend(),
      platform: 'chilloutvr',
      status: null,
      statusDescription: null,
      trustRank: null
    } as Friend
    const list = [cached]

    const next = applyFriendEvent(list, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_a',
      worldName: 'The Pug',
      thumbnailUrl: 'https://example.com/pug.jpg'
    })

    expect(next).toBe(list)
    expect(next[0]).toBe(cached)
  })

  it('world-metadata with already-equal values preserves array and friend identity', () => {
    const cached = friend()
    const list = [cached]

    const next = applyFriendEvent(list, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_a',
      worldName: 'The Pug',
      thumbnailUrl: null
    })

    expect(next).toBe(list)
    expect(next[0]).toBe(cached)
  })

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

  it("friends-snapshot scope 'all' replaces the list wholesale (new array; local state preserved)", () => {
    const replacement = [friend({ platformUserId: 'usr_9' })]
    const next = applyFriendEvent([friend()], {
      type: 'friends-snapshot',
      platform: 'vrchat',
      scope: 'all',
      friends: replacement
    })
    // A full snapshot now maps to preserve cached local-ish state, so it is a
    // new array even when contents match (audit OP-B3).
    expect(next).not.toBe(replacement)
    expect(next).toEqual(replacement)
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
            groupId: null,
            groupImageUrl: null,
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

  it('presence-snapshot applies an update whose instance differs ONLY in group fields (equality regression, VRX-260)', () => {
    // Defensive pin: `sameInstance` must compare groupId/groupImageUrl/groupName.
    // No CVR payload carries group data TODAY (fields are producer-null), so this
    // uses a synthetic entry — the compares exist so a future producer (or a
    // misrouted event) can never have its update dropped as "unchanged" (the
    // VRX-240 opennessUnknown lesson, pinned mutation-real).
    const inst = {
      worldId: 'i_1',
      instanceId: 'i_1',
      worldName: 'Lounge',
      thumbnailUrl: null,
      type: 'friends',
      openness: 'friends',
      isGroup: true,
      groupName: 'Old Crew',
      groupId: 'grp_1',
      groupImageUrl: null,
      region: null,
      userCount: null
    }
    const friend = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_grp',
      displayName: 'grp',
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
    const next = applyFriendEvent([friend], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_grp',
          presence: { state: 'in-game' },
          instance: { ...inst, groupImageUrl: 'https://files.abidata.io/grp.png' }
        }
      ]
    } as never)
    expect(next[0]).not.toBe(friend)
    expect(next[0]?.instance?.groupImageUrl).toBe('https://files.abidata.io/grp.png')
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
      groupId: null,
      groupImageUrl: null,
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

  it('presence-snapshot replaces a known instance when only its openness-unknown tag changes', () => {
    const knownInvite: CvrFriend = {
      ...friend(),
      platform: 'chilloutvr',
      presence: { state: 'in-game' },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: {
        ...friend().instance!,
        type: 'owner-must-invite',
        openness: 'invite'
      }
    }
    const unknownInvite = {
      ...knownInvite.instance!,
      opennessUnknown: true as const
    }

    const next = applyFriendEvent([knownInvite], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: knownInvite.platformUserId,
          presence: { state: 'in-game' },
          instance: unknownInvite
        }
      ]
    })

    expect(next[0]).not.toBe(knownInvite)
    expect(next[0]!.instance).toBe(unknownInvite)
    expect(next[0]!.instance).toMatchObject({ opennessUnknown: true })
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
      groupId: null,
      groupImageUrl: null,
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

  it('friend-updated for an unknown friend is a no-op (preserves array identity)', () => {
    const list = [friend()]
    const next = applyFriendEvent(list, {
      type: 'friend-updated',
      platform: 'vrchat',
      friend: friend({ platformUserId: 'usr_unknown', displayName: 'Stranger' })
    })
    expect(next).toBe(list)
    expect(next).toHaveLength(1)
  })

  it("friends-snapshot scope 'all' preserves cached isFavorite/favoriteGroupIds/linkedPersonId", () => {
    const replacement = friend({
      displayName: 'Alice New Avatar',
      // Wire defaults — must be overwritten from cache.
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
    const next = applyFriendEvent([friend()], {
      type: 'friends-snapshot',
      platform: 'vrchat',
      scope: 'all',
      friends: [replacement]
    })
    expect(next[0]).toMatchObject({
      displayName: 'Alice New Avatar',
      isFavorite: true,
      favoriteGroupIds: ['grp_fav'],
      linkedPersonId: 'person_1'
    })
  })

  it('preserves isFavorite/favoriteGroupIds/linkedPersonId on friend-presence (audit OP-A1)', () => {
    const incoming = friend({
      presence: { state: 'active' },
      instance: null,
      // Wire hardcodes these to defaults — must not stomp user-authored state.
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
    const next = applyFriendEvent([friend()], {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: incoming
    })
    expect(next[0]).toMatchObject({
      isFavorite: true,
      favoriteGroupIds: ['grp_fav'],
      linkedPersonId: 'person_1'
    })
  })

  it('preserves isFavorite/favoriteGroupIds/linkedPersonId on friend-added re-add (audit OP-A1)', () => {
    const reAdd = friend({
      displayName: 'Alice Re-added',
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
    const next = applyFriendEvent([friend()], {
      type: 'friend-added',
      platform: 'vrchat',
      friend: reAdd
    })
    expect(next[0]).toMatchObject({
      displayName: 'Alice Re-added',
      isFavorite: true,
      favoriteGroupIds: ['grp_fav'],
      linkedPersonId: 'person_1'
    })
  })

  it('returns the SAME array reference for a no-change presence-snapshot', () => {
    const list = [friend()]
    const next = applyFriendEvent(list, {
      type: 'presence-snapshot',
      platform: 'vrchat',
      entries: [
        {
          platformUserId: 'usr_1',
          presence: { state: 'in-game' },
          instance: { ...friend().instance } as never
        }
      ]
    })
    expect(next).toBe(list)
  })

  it('updates when only groupName differs (per-field equality, VRX-260)', () => {
    const inst = {
      worldId: 'i_1',
      instanceId: 'i_1',
      worldName: 'Lounge',
      thumbnailUrl: null,
      type: 'group',
      openness: 'invite',
      isGroup: true,
      groupName: 'Old Crew',
      groupId: 'grp_1',
      groupImageUrl: null,
      region: null,
      userCount: null
    }
    const f = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_grp_name',
      displayName: 'name',
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
    const next = applyFriendEvent([f], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_grp_name',
          presence: { state: 'in-game' },
          instance: { ...inst, groupName: 'New Crew' }
        }
      ]
    } as never)
    expect(next[0]).not.toBe(f)
    expect(next[0]?.instance?.groupName).toBe('New Crew')
  })

  it('updates when only groupId differs (per-field equality, VRX-260)', () => {
    const inst = {
      worldId: 'i_1',
      instanceId: 'i_1',
      worldName: 'Lounge',
      thumbnailUrl: null,
      type: 'group',
      openness: 'invite',
      isGroup: true,
      groupName: 'Crew',
      groupId: 'grp_1',
      groupImageUrl: null,
      region: null,
      userCount: null
    }
    const f = {
      platform: 'chilloutvr',
      platformUserId: 'cvr_grp_id',
      displayName: 'id',
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
    const next = applyFriendEvent([f], {
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_grp_id',
          presence: { state: 'in-game' },
          instance: { ...inst, groupId: 'grp_2' }
        }
      ]
    } as never)
    expect(next[0]).not.toBe(f)
    expect(next[0]?.instance?.groupId).toBe('grp_2')
  })
})
