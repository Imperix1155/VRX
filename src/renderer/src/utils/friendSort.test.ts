import { describe, expect, it } from 'vitest'
import type { ActivityEntry } from '@shared/activity'
import type { Friend, InstanceInfo, OpennessTier, Platform, PresenceState } from '@shared/types'
import { latestActivityByFriend, sortFriendRows } from './friendSort'
import { projectLinkedFriends, type LinkedRow } from './projectLinkedFriends'

function instance(worldId: string, instanceId: string, openness: OpennessTier): InstanceInfo {
  return {
    worldId,
    instanceId,
    worldName: worldId.replace('wrld_', ''),
    thumbnailUrl: null,
    type: 'public',
    openness,
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: null,
    userCount: null
  }
}

function friend(
  platform: Platform,
  name: string,
  state: PresenceState,
  where: InstanceInfo | null = null
): Friend {
  return {
    platformUserId: `usr_${name}`,
    platform,
    displayName: name,
    avatarUrl: null,
    presence: { state },
    status: platform === 'vrchat' ? 'online' : null,
    statusDescription: null,
    trustRank: null,
    instance: where,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as Friend
}

function rows(friends: Friend[]): LinkedRow[] {
  return projectLinkedFriends({
    friends,
    profiles: [],
    accountIds: { vrchat: 'vrc', chilloutvr: 'cvr' },
    filter: 'all',
    search: ''
  }).rows
}

const names = (list: { name: string }[]): string[] => list.map((row) => row.name)
const none = { latestActivity: new Map<string, number>() }

describe('sortFriendRows', () => {
  const lobby = instance('wrld_Lobby', '1', 'public')
  const cafe = instance('wrld_Cafe', '7', 'friends')
  const roster = [
    friend('chilloutvr', 'Anna', 'in-game', cafe),
    friend('vrchat', 'Ben', 'in-game', lobby),
    friend('vrchat', 'Cleo', 'in-game', lobby),
    friend('chilloutvr', 'Dan', 'in-game', null),
    friend('vrchat', 'Eve', 'active'),
    friend('vrchat', 'Finn', 'offline'),
    friend('chilloutvr', 'Gus', 'offline')
  ]

  it('keeps the A to Z order for Name', () => {
    const input = rows(roster)
    expect(sortFriendRows(input, 'name', none)).toBe(input)
  })

  it('puts friends in the same instance together, the biggest crowd first, on both platforms', () => {
    expect(names(sortFriendRows(rows(roster), 'world', none))).toEqual([
      'Ben',
      'Cleo',
      'Anna',
      'Dan',
      'Eve',
      'Finn',
      'Gus'
    ])
  })

  it('keeps one ChilloutVR instance together while its world is still being looked up', () => {
    // CVR's live feed first reports the instance id as the world id; the
    // resolved world id arrives later. The instance id alone names the crowd.
    const pending = { ...instance('i+abc', 'i+abc', 'public'), worldName: null }
    const resolved = instance('wrld_Zoo', 'i+abc', 'public')
    const crowd = [
      friend('vrchat', 'Anna', 'in-game', instance('wrld_Alpha', '1', 'public')),
      friend('chilloutvr', 'Ben', 'in-game', pending),
      friend('chilloutvr', 'Cleo', 'in-game', resolved)
    ]
    expect(names(sortFriendRows(rows(crowd), 'world', none))).toEqual(['Ben', 'Cleo', 'Anna'])
  })

  it('puts the most open instance you can join first', () => {
    const open = [
      friend('vrchat', 'Anna', 'in-game', instance('wrld_A', '1', 'invite')),
      friend('chilloutvr', 'Ben', 'in-game', null),
      friend('chilloutvr', 'Cleo', 'in-game', instance('wrld_C', '1', 'public')),
      friend('vrchat', 'Dan', 'in-game', instance('wrld_D', '1', 'friends-plus'))
    ]
    expect(names(sortFriendRows(rows(open), 'joinable', none))).toEqual([
      'Cleo',
      'Dan',
      'Anna',
      'Ben'
    ])
  })

  it('puts the newest Activity first inside each group and never moves a row between groups', () => {
    const entries: ActivityEntry[] = [
      {
        id: 3,
        kind: 'offline',
        platform: 'chilloutvr',
        platformUserId: 'usr_Gus',
        displayName: 'Gus',
        worldName: null,
        at: 300
      },
      {
        id: 2,
        kind: 'world',
        platform: 'chilloutvr',
        platformUserId: 'usr_Dan',
        displayName: 'Dan',
        worldName: null,
        at: 200
      },
      {
        id: 1,
        kind: 'online',
        platform: 'vrchat',
        platformUserId: 'usr_Cleo',
        displayName: 'Cleo',
        worldName: null,
        at: 100
      }
    ]
    const sorted = sortFriendRows(rows(roster), 'recent', {
      latestActivity: latestActivityByFriend(entries)
    })
    expect(names(sorted)).toEqual(['Dan', 'Cleo', 'Anna', 'Ben', 'Eve', 'Gus', 'Finn'])
  })
})
