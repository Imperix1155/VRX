/**
 * mergeKnownWorldMetadata tests (VRX-258) — pins the cold-start roster merge:
 * known world names/thumbnails survive a nameless REST refetch only when the
 * friend is still in the same world; moved friends and non-null fresh values
 * never inherit stale metadata; identity is preserved for memo'd rows.
 */
import { describe, expect, it } from 'vitest'
import type { CvrFriend, Friend, VrcFriend } from '@shared/types'
import { mergeKnownWorldMetadata } from './mergeKnownWorldMetadata'

function vrcFriend(overrides: Partial<VrcFriend> = {}): Friend {
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
      thumbnailUrl: 'https://example.com/pug.jpg',
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

function cvrFriend(overrides: Partial<CvrFriend> = {}): Friend {
  const base: CvrFriend = {
    platform: 'chilloutvr',
    platformUserId: 'cvr_1',
    displayName: 'Bob',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: null,
    statusDescription: null,
    trustRank: null,
    instance: {
      worldId: 'wrld_c',
      worldName: 'CVR Lounge',
      instanceId: 'c1',
      type: 'public',
      openness: 'public',
      isGroup: false,
      region: null,
      thumbnailUrl: 'https://example.com/cvr.jpg',
      groupName: null,
      groupId: null,
      groupImageUrl: null,
      userCount: null
    },
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  return { ...base, ...overrides }
}

function withInstance(friend: Friend, patch: Partial<Friend['instance']> | null): Friend {
  if (patch === null) return { ...friend, instance: null }
  return { ...friend, instance: { ...friend.instance!, ...patch } }
}

describe('mergeKnownWorldMetadata', () => {
  it('fills worldName and thumbnailUrl when the worldId matches and fresh values are null', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), { worldName: null, thumbnailUrl: null })]

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next[0]!.instance!.worldName).toBe('The Pug')
    expect(next[0]!.instance!.thumbnailUrl).toBe('https://example.com/pug.jpg')
  })

  it('fills worldName and thumbnailUrl independently', () => {
    const cached = [vrcFriend()]
    const freshNameKnown = [
      withInstance(vrcFriend(), { worldName: 'Fresh Name', thumbnailUrl: null })
    ]
    const freshThumbKnown = [
      withInstance(vrcFriend(), { worldName: null, thumbnailUrl: 'https://example.com/fresh.jpg' })
    ]

    const nameKnown = mergeKnownWorldMetadata(cached, freshNameKnown)[0]!.instance!
    expect(nameKnown.worldName).toBe('Fresh Name')
    expect(nameKnown.thumbnailUrl).toBe('https://example.com/pug.jpg')

    const thumbKnown = mergeKnownWorldMetadata(cached, freshThumbKnown)[0]!.instance!
    expect(thumbKnown.worldName).toBe('The Pug')
    expect(thumbKnown.thumbnailUrl).toBe('https://example.com/fresh.jpg')
  })

  it('does not fill when the friend moved to a different world', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), { worldId: 'wrld_b', worldName: null })]

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance!.worldName).toBeNull()
  })

  it('keeps a non-null fresh worldName even when cached has a different one', () => {
    const cached = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: 'Old Name' } })]
    const fresh = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: 'New Name' } })]

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next[0]!.instance!.worldName).toBe('New Name')
  })

  it('does not resurrect an instance for an offline/private friend', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), null)]

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance).toBeNull()
  })

  it('ignores missing cached friends and never inserts cached-only friends', () => {
    const fresh = [vrcFriend({ platformUserId: 'usr_fresh' })]
    const cachedOnly = [vrcFriend({ platformUserId: 'usr_cached_only' })]

    expect(mergeKnownWorldMetadata(undefined, fresh)).toBe(fresh)
    expect(mergeKnownWorldMetadata(cachedOnly, fresh)).toBe(fresh)
    expect(mergeKnownWorldMetadata(cachedOnly, fresh)).toHaveLength(1)
  })

  it('preserves reference identity for unchanged friends and the whole array on no-op', () => {
    const fresh = [vrcFriend(), vrcFriend({ platformUserId: 'usr_2' })]
    const cached = fresh

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next).toBe(fresh)
    expect(next[0]).toBe(fresh[0])
    expect(next[1]).toBe(fresh[1])

    const changedFresh: Friend[] = [
      fresh[0]!,
      withInstance(vrcFriend({ platformUserId: 'usr_2' }), { worldName: null })
    ]
    const mixed = mergeKnownWorldMetadata(cached, changedFresh)
    expect(mixed[0]).toBe(changedFresh[0])
    expect(mixed[1]).not.toBe(changedFresh[1])
  })

  it('scopes matches to the same platform for the same platformUserId', () => {
    const cached = [cvrFriend({ platformUserId: 'usr_shared' })]
    const fresh = [
      withInstance(vrcFriend({ platformUserId: 'usr_shared' }), {
        worldName: null,
        thumbnailUrl: null
      })
    ]

    const next = mergeKnownWorldMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance!.worldName).toBeNull()
    expect(next[0]!.instance!.thumbnailUrl).toBeNull()
  })

  it('never mutates the input arrays or objects', () => {
    const fresh = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: null } })]
    const cached = [vrcFriend()]
    mergeKnownWorldMetadata(cached, fresh)
    expect(fresh[0]!.instance!.worldName).toBeNull()
    expect(cached[0]!.instance!.worldName).toBe('The Pug')
  })
})
