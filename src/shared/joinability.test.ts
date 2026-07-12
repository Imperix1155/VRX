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
  it('accepts an in-game friend with a visible networked instance', () => {
    expect(isFriendJoinable(friend())).toBe(true)
  })

  it.each(['active', 'offline'] as const)('rejects %s presence', (state) => {
    expect(isFriendJoinable(friend({ presence: { state } }))).toBe(false)
  })

  it('rejects a hidden world', () => {
    expect(isFriendJoinable(friend({ instance: null }))).toBe(false)
  })

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
