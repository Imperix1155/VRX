import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  CvrFriend,
  Friend,
  InstanceInfo,
  InstanceType,
  PresenceState,
  UserStatus,
  VrcFriend
} from './types'

const vrchatFriend = {
  platformUserId: 'usr_fixture',
  platform: 'vrchat',
  displayName: 'VRChat Friend',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'join-me',
  statusDescription: 'Come hang out!',
  instance: {
    worldId: 'wrld_fixture',
    instanceId: 'instance_fixture',
    worldName: 'Fixture World',
    thumbnailUrl: null,
    type: 'public',
    openness: 'public',
    isGroup: false,
    groupName: null,
    region: null,
    userCount: null
  },
  trustRank: 'trusted',
  isFavorite: true,
  favoriteGroupIds: ['group_fixture'],
  linkedPersonId: 'person_fixture'
} satisfies Friend

const chilloutvrFriend = {
  platformUserId: 'cvr-fixture',
  platform: 'chilloutvr',
  displayName: 'ChilloutVR Friend',
  avatarUrl: null,
  presence: { state: 'offline' },
  status: null,
  statusDescription: null,
  instance: null,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
} satisfies Friend

describe('Friend contract', () => {
  it('keeps platform-true instance type distinct from normalized openness', () => {
    expectTypeOf<InstanceInfo['type']>().toEqualTypeOf<InstanceType>()
    expectTypeOf<InstanceInfo['type']>().not.toEqualTypeOf<InstanceInfo['openness']>()
    expect(vrchatFriend.instance.type).toBe('public')
  })

  it('keeps system presence and user status as distinct axes', () => {
    expectTypeOf<Friend['presence']['state']>().toEqualTypeOf<PresenceState>()
    expectTypeOf<Friend['status']>().toEqualTypeOf<UserStatus>()
    expectTypeOf<Extract<Friend, { platform: 'vrchat' }>>().toEqualTypeOf<VrcFriend>()
    expect(vrchatFriend.presence.state).toBe('in-game')
    expect(vrchatFriend.status).toBe('join-me')
  })

  it('represents unavailable ChilloutVR-only fields with null', () => {
    expectTypeOf<Extract<Friend, { platform: 'chilloutvr' }>>().toEqualTypeOf<CvrFriend>()
    expectTypeOf<CvrFriend['presence']['state']>().toEqualTypeOf<'in-game' | 'offline'>()
    expectTypeOf<CvrFriend['status']>().toEqualTypeOf<null>()
    expect(chilloutvrFriend.status).toBeNull()
    expect(chilloutvrFriend.statusDescription).toBeNull()
    expect(chilloutvrFriend.trustRank).toBeNull()
  })
})
