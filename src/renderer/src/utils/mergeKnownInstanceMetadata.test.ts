/**
 * mergeKnownInstanceMetadata tests (VRX-258 / VRX-260) — pins the cold-start
 * roster merge: known world/group names/images survive a nameless REST refetch
 * only when the friend is still in the same world/group; moved friends and
 * non-null fresh values never inherit stale metadata; identity is preserved for
 * memo'd rows.
 */
import { describe, expect, it } from 'vitest'
import type { CvrFriend, Friend, VrcFriend } from '@shared/types'
import { mergeKnownInstanceMetadata } from './mergeKnownInstanceMetadata'

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

describe('mergeKnownInstanceMetadata', () => {
  it('fills worldName and thumbnailUrl when the worldId matches and fresh values are null', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), { worldName: null, thumbnailUrl: null })]

    const next = mergeKnownInstanceMetadata(cached, fresh)

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

    const nameKnown = mergeKnownInstanceMetadata(cached, freshNameKnown)[0]!.instance!
    expect(nameKnown.worldName).toBe('Fresh Name')
    expect(nameKnown.thumbnailUrl).toBe('https://example.com/pug.jpg')

    const thumbKnown = mergeKnownInstanceMetadata(cached, freshThumbKnown)[0]!.instance!
    expect(thumbKnown.worldName).toBe('The Pug')
    expect(thumbKnown.thumbnailUrl).toBe('https://example.com/fresh.jpg')
  })

  it('does not fill world fields when the friend moved to a different world', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), { worldId: 'wrld_b', worldName: null })]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance!.worldName).toBeNull()
  })

  it('keeps a non-null fresh worldName even when cached has a different one', () => {
    const cached = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: 'Old Name' } })]
    const fresh = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: 'New Name' } })]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]!.instance!.worldName).toBe('New Name')
  })

  it('does not resurrect an instance for an offline/private friend', () => {
    const cached = [vrcFriend()]
    const fresh = [withInstance(vrcFriend(), null)]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance).toBeNull()
  })

  it('ignores missing cached friends and never inserts cached-only friends', () => {
    const fresh = [vrcFriend({ platformUserId: 'usr_fresh' })]
    const cachedOnly = [vrcFriend({ platformUserId: 'usr_cached_only' })]

    expect(mergeKnownInstanceMetadata(undefined, fresh)).toBe(fresh)
    expect(mergeKnownInstanceMetadata(cachedOnly, fresh)).toBe(fresh)
    expect(mergeKnownInstanceMetadata(cachedOnly, fresh)).toHaveLength(1)
  })

  it('preserves reference identity for unchanged friends and the whole array on no-op', () => {
    const fresh = [vrcFriend(), vrcFriend({ platformUserId: 'usr_2' })]
    const cached = fresh

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next).toBe(fresh)
    expect(next[0]).toBe(fresh[0])
    expect(next[1]).toBe(fresh[1])

    const changedFresh: Friend[] = [
      fresh[0]!,
      withInstance(vrcFriend({ platformUserId: 'usr_2' }), { worldName: null })
    ]
    const mixed = mergeKnownInstanceMetadata(cached, changedFresh)
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

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance!.worldName).toBeNull()
    expect(next[0]!.instance!.thumbnailUrl).toBeNull()
  })

  it('never mutates the input arrays or objects', () => {
    const fresh = [vrcFriend({ instance: { ...vrcFriend().instance!, worldName: null } })]
    const cached = [vrcFriend()]
    mergeKnownInstanceMetadata(cached, fresh)
    expect(fresh[0]!.instance!.worldName).toBeNull()
    expect(cached[0]!.instance!.worldName).toBe('The Pug')
  })

  it('fills groupName and groupImageUrl when groupId matches and fresh values are null', () => {
    const cached = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Pixel Pals',
        groupImageUrl: 'https://example.com/pals.png'
      })
    ]
    const fresh = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: null,
        groupImageUrl: null
      })
    ]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]!.instance!.groupName).toBe('Pixel Pals')
    expect(next[0]!.instance!.groupImageUrl).toBe('https://example.com/pals.png')
  })

  it('fills groupName and groupImageUrl independently', () => {
    const cached = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Pixel Pals',
        groupImageUrl: 'https://example.com/pals.png'
      })
    ]
    const freshNameKnown = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Fresh Group',
        groupImageUrl: null
      })
    ]
    const freshImageKnown = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: null,
        groupImageUrl: 'https://example.com/fresh.png'
      })
    ]

    const nameKnown = mergeKnownInstanceMetadata(cached, freshNameKnown)[0]!.instance!
    expect(nameKnown.groupName).toBe('Fresh Group')
    expect(nameKnown.groupImageUrl).toBe('https://example.com/pals.png')

    const imageKnown = mergeKnownInstanceMetadata(cached, freshImageKnown)[0]!.instance!
    expect(imageKnown.groupName).toBe('Pixel Pals')
    expect(imageKnown.groupImageUrl).toBe('https://example.com/fresh.png')
  })

  it('does not fill group fields when groupId changed', () => {
    const cached = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_old',
        groupName: 'Old Crew',
        groupImageUrl: 'https://example.com/old.png'
      })
    ]
    const fresh = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_new',
        groupName: null,
        groupImageUrl: null
      })
    ]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]).toBe(fresh[0])
    expect(next[0]!.instance!.groupName).toBeNull()
    expect(next[0]!.instance!.groupImageUrl).toBeNull()
  })

  it('does not fill group fields when fresh already has a non-null value', () => {
    const cached = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Cached Name',
        groupImageUrl: 'https://example.com/cached.png'
      })
    ]
    const fresh = [
      withInstance(vrcFriend(), {
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Fresh Name',
        groupImageUrl: 'https://example.com/fresh.png'
      })
    ]

    const next = mergeKnownInstanceMetadata(cached, fresh)

    expect(next[0]!.instance!.groupName).toBe('Fresh Name')
    expect(next[0]!.instance!.groupImageUrl).toBe('https://example.com/fresh.png')
  })

  it('fills world and group fields independently (one fills while the other does not)', () => {
    const cached = [
      withInstance(vrcFriend(), {
        worldName: 'The Pug',
        thumbnailUrl: 'https://example.com/pug.jpg',
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: 'Pixel Pals',
        groupImageUrl: 'https://example.com/pals.png'
      })
    ]
    const fresh = [
      withInstance(vrcFriend(), {
        worldId: 'wrld_b',
        worldName: null,
        thumbnailUrl: null,
        type: 'group-plus',
        openness: 'friends-plus',
        isGroup: true,
        groupId: 'grp_x',
        groupName: null,
        groupImageUrl: null
      })
    ]

    const next = mergeKnownInstanceMetadata(cached, fresh)[0]!.instance!

    // World moved → no world fill.
    expect(next.worldName).toBeNull()
    expect(next.thumbnailUrl).toBeNull()
    // Group stayed → group fills.
    expect(next.groupName).toBe('Pixel Pals')
    expect(next.groupImageUrl).toBe('https://example.com/pals.png')
  })
})
