import { describe, expect, it } from 'vitest'
import type { Friend, InstanceInfo } from './types'
import { isFriendJoinable } from './joinability'

const instance: InstanceInfo = {
  worldId: 'wrld_example',
  instanceId: 'instance-1',
  worldName: 'Example',
  thumbnailUrl: null,
  type: 'friends',
  openness: 'friends',
  isGroup: false,
  groupName: null,
  region: null,
  userCount: null
}

function friend(overrides: Partial<Friend> = {}): Friend {
  return {
    platform: 'vrchat',
    platformUserId: 'usr_friend',
    displayName: 'Friend',
    avatarUrl: null,
    presence: { state: 'in-game' },
    instance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null,
    ...overrides
  } as Friend
}

describe('isFriendJoinable', () => {
  it.each(['online', 'join-me'] as const)(
    'accepts an in-game VRChat friend with %s status and a visible networked instance',
    (status) => {
      expect(isFriendJoinable(friend({ status }))).toBe(true)
    }
  )

  it.each(['ask-me', 'dnd'] as const)(
    'rejects an in-game VRChat friend with %s status despite a real instance',
    (status) => {
      expect(isFriendJoinable(friend({ status }))).toBe(false)
    }
  )

  it.each(['active', 'offline'] as const)('rejects %s presence', (state) => {
    expect(isFriendJoinable(friend({ presence: { state } }))).toBe(false)
  })

  it.each(['', 'private', 'offline', 'traveling'])(
    'rejects hidden world sentinel %j',
    (worldId) => {
      expect(isFriendJoinable(friend({ instance: { ...instance, worldId } }))).toBe(false)
    }
  )

  it('rejects CVR offline instances', () => {
    expect(
      isFriendJoinable(
        friend({
          platform: 'chilloutvr',
          status: null,
          statusDescription: null,
          trustRank: null,
          instance: { ...instance, type: 'offline', openness: 'offline' }
        })
      )
    ).toBe(false)
  })
})
