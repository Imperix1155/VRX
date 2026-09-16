import type {
  CvrFriend,
  CvrInstanceType,
  Friend,
  InstanceInfo,
  Platform,
  VrcFriend,
  VrcInstanceType
} from '@shared/types'
import type {
  ExplorePlatformSnapshot,
  ExploreRoom,
  ExploreWorld,
  ExploreWorldSnapshot
} from '@shared/explore'
import type { LinkSnapshot } from '@shared/linkedProfiles'

export type PlatformMode =
  'ready' | 'loading' | 'refreshing' | 'error' | 'stale' | 'empty' | 'unavailable'
type WorldMode = 'ready' | 'loading' | 'error' | 'stale'

function illustration(first: string, second: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="560" viewBox="0 0 1280 560"><defs><linearGradient id="sky" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="28"/></filter></defs><rect width="1280" height="560" fill="url(#sky)"/><circle cx="1080" cy="106" r="172" fill="#fff" fill-opacity=".16" filter="url(#blur)"/><path d="M0 405 C190 300 280 475 470 365 S735 305 880 405 S1100 300 1280 390 V560 H0Z" fill="#060917" fill-opacity=".44"/><path d="M0 445 C245 355 370 515 585 405 S940 344 1280 445 V560 H0Z" fill="#02030a" fill-opacity=".4"/><g fill="#fff" fill-opacity=".52"><circle cx="100" cy="274" r="5"/><circle cx="188" cy="231" r="3"/><circle cx="272" cy="284" r="4"/><circle cx="764" cy="181" r="4"/><circle cx="870" cy="242" r="3"/><circle cx="1130" cy="302" r="5"/></g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function vrcInstance(
  type: VrcInstanceType,
  worldId: string,
  worldName: string,
  overrides: Partial<InstanceInfo> = {}
): InstanceInfo {
  return {
    worldId,
    instanceId: `guide-vrc-${type}`,
    worldName,
    thumbnailUrl: null,
    type,
    openness:
      type === 'public' || type === 'group-public'
        ? 'public'
        : type === 'friends-plus'
          ? 'friends-plus'
          : type === 'friends'
            ? 'friends'
            : type === 'invite-plus'
              ? 'invite-plus'
              : type === 'group-plus'
                ? 'friends-plus'
                : 'invite',
    isGroup: type.startsWith('group'),
    groupName: type.startsWith('group') ? 'Synthetic Stargazers' : null,
    groupId: type.startsWith('group') ? 'grp-guide-stargazers' : null,
    groupImageUrl: null,
    region: 'us',
    userCount: 18,
    ...overrides
  }
}

function cvrInstance(
  type: CvrInstanceType,
  worldId: string,
  worldName: string,
  overrides: Partial<InstanceInfo> = {}
): InstanceInfo {
  return {
    worldId,
    instanceId: `guide-cvr-${type}`,
    worldName,
    thumbnailUrl: null,
    type,
    openness:
      type === 'public' || type === 'group-public'
        ? 'public'
        : type === 'friends-of-friends'
          ? 'friends-plus'
          : type === 'friends'
            ? 'friends'
            : type === 'everyone-can-invite'
              ? 'invite-plus'
              : type === 'friends-of-members'
                ? 'friends-plus'
                : type === 'offline'
                  ? 'offline'
                  : 'invite',
    isGroup: type === 'group-public' || type === 'friends-of-members' || type === 'members-only',
    groupName:
      type === 'group-public' || type === 'friends-of-members' || type === 'members-only'
        ? 'Synthetic Stargazers'
        : null,
    groupId:
      type === 'group-public' || type === 'friends-of-members' || type === 'members-only'
        ? 'grp-guide-stargazers'
        : null,
    groupImageUrl: null,
    region: 'eu',
    userCount: type === 'offline' ? null : 11,
    ...overrides
  }
}

function vrcFriend(
  platformUserId: string,
  displayName: string,
  state: VrcFriend['presence']['state'],
  status: VrcFriend['status'],
  instance: InstanceInfo | null,
  linkedPersonId: string | null = null
): VrcFriend {
  return {
    platform: 'vrchat',
    platformUserId,
    displayName,
    avatarUrl: null,
    presence: { state },
    status,
    statusDescription: status === 'dnd' ? 'Editing a tiny moon' : null,
    trustRank: status === 'join-me' ? 'trusted' : 'known',
    instance,
    isFavorite: status === 'join-me',
    favoriteGroupIds: status === 'join-me' ? ['fav-guide'] : [],
    linkedPersonId
  }
}

function cvrFriend(
  platformUserId: string,
  displayName: string,
  state: CvrFriend['presence']['state'],
  instance: InstanceInfo | null,
  linkedPersonId: string | null = null
): CvrFriend {
  return {
    platform: 'chilloutvr',
    platformUserId,
    displayName,
    avatarUrl: null,
    presence: { state },
    status: null,
    statusDescription: null,
    trustRank: null,
    instance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId
  }
}

const auroraVrc = vrcInstance('public', 'wrld-guide-aurora', 'Aurora Transit Lounge', {
  thumbnailUrl: 'guide-world-vrc-aurora'
})
const auroraCvr = cvrInstance('public', 'cvr-guide-aurora', 'Aurora Transit Lounge', {
  thumbnailUrl: 'guide-world-cvr-aurora'
})
const gardenVrc = vrcInstance('friends-plus', 'wrld-guide-garden', 'The Conservatory After Rain', {
  thumbnailUrl: 'guide-world-vrc-garden'
})
const hallCvr = cvrInstance(
  'friends-of-members',
  'cvr-guide-hall',
  'Midnight Museum of Small Wonders',
  { thumbnailUrl: 'guide-world-cvr-hall' }
)

/** Populated, deliberately varied roster for guide-only dashboard and friend examples. */
export const friends: Record<Platform, Friend[]> = {
  vrchat: [
    vrcFriend(
      'usr-guide-nyx',
      'Nyx “Long Name” Hyperion-Santos',
      'in-game',
      'join-me',
      auroraVrc,
      'person-guide-nyx'
    ),
    vrcFriend('usr-guide-iris', 'Iris Circuitbreaker', 'in-game', 'online', auroraVrc),
    vrcFriend('usr-guide-vale', 'Vale After the Last Train', 'in-game', 'ask-me', gardenVrc),
    vrcFriend('usr-guide-ember', 'Ember (building a cloud)', 'in-game', 'dnd', null),
    vrcFriend('usr-guide-kai', 'Kai', 'active', 'online', null),
    vrcFriend(
      'usr-guide-sol',
      'Sol in a Very Long Display Name That Truncates Gracefully',
      'offline',
      null,
      null
    ),
    vrcFriend('usr-guide-rin', 'Rin', 'in-game', 'online', auroraVrc),
    vrcFriend('usr-guide-mica', 'Mica', 'in-game', 'join-me', auroraVrc)
  ],
  chilloutvr: [
    cvrFriend('cvr-guide-nyx', 'Nyx Hyperion', 'in-game', auroraCvr, 'person-guide-nyx'),
    cvrFriend('cvr-guide-marlow', 'Marlow, Archive Keeper', 'in-game', auroraCvr),
    cvrFriend('cvr-guide-pixel', 'Pixel Orchard', 'in-game', hallCvr),
    cvrFriend('cvr-guide-fern', 'Fern', 'in-game', auroraCvr),
    cvrFriend('cvr-guide-delta', 'Delta Frame', 'offline', null),
    cvrFriend(
      'cvr-guide-moss',
      'Moss With An Equally Impractical But Readable Name',
      'offline',
      null
    ),
    cvrFriend('cvr-guide-echo', 'Echo', 'in-game', auroraCvr),
    cvrFriend('cvr-guide-oak', 'Oak', 'in-game', hallCvr)
  ]
}

export const worlds: Record<Platform, ExploreWorld[]> = {
  vrchat: [
    {
      platform: 'vrchat',
      worldId: 'wrld-guide-aurora',
      worldRef: 'guide-world-vrc-aurora',
      name: 'Aurora Transit Lounge',
      thumbnailUrl: null,
      activity: { state: 'complete', value: 47, source: 'vrc-world-occupants' },
      visibleRoomCount: { state: 'complete', value: 3, source: 'visible-rooms' },
      popularity: 47,
      sourceOrder: 0
    },
    {
      platform: 'vrchat',
      worldId: 'wrld-guide-garden',
      worldRef: 'guide-world-vrc-garden',
      name: 'The Conservatory After Rain',
      thumbnailUrl: null,
      activity: { state: 'complete', value: 24, source: 'vrc-room-n-users' },
      visibleRoomCount: { state: 'complete', value: 2, source: 'visible-rooms' },
      popularity: 24,
      sourceOrder: 1
    },
    {
      platform: 'vrchat',
      worldId: 'wrld-guide-night',
      worldRef: 'guide-world-vrc-night',
      name: 'Night Shift Radio Telescope',
      thumbnailUrl: null,
      activity: { state: 'partial', value: null, source: 'vrc-world-tuple' },
      visibleRoomCount: { state: 'unknown', value: null, source: 'visible-rooms' },
      popularity: null,
      sourceOrder: 2
    }
  ],
  chilloutvr: [
    {
      platform: 'chilloutvr',
      worldId: 'cvr-guide-aurora',
      worldRef: 'guide-world-cvr-aurora',
      name: 'Aurora Transit Lounge',
      thumbnailUrl: null,
      activity: { state: 'complete', value: 31, source: 'cvr-room-current-player-count' },
      visibleRoomCount: { state: 'complete', value: 2, source: 'cvr-public-rooms' },
      popularity: 31,
      sourceOrder: 0
    },
    {
      platform: 'chilloutvr',
      worldId: 'cvr-guide-hall',
      worldRef: 'guide-world-cvr-hall',
      name: 'Midnight Museum of Small Wonders',
      thumbnailUrl: null,
      activity: { state: 'partial', value: null, source: 'cvr-public-rooms' },
      visibleRoomCount: { state: 'complete', value: 1, source: 'cvr-public-rooms' },
      popularity: null,
      sourceOrder: 1
    },
    {
      platform: 'chilloutvr',
      worldId: 'cvr-guide-sand',
      worldRef: 'guide-world-cvr-sand',
      name: 'Low Tide Observatory',
      thumbnailUrl: null,
      activity: { state: 'complete', value: 16, source: 'cvr-public-rooms' },
      visibleRoomCount: { state: 'complete', value: 1, source: 'cvr-public-rooms' },
      popularity: 16,
      sourceOrder: 2
    }
  ]
}

export const worldImages: Record<string, string> = {
  'guide-world-vrc-aurora': illustration('#185ad4', '#9f4ede'),
  'guide-world-vrc-garden': illustration('#145e61', '#3aa36d'),
  'guide-world-vrc-night': illustration('#242557', '#6d5cc8'),
  'guide-world-cvr-aurora': illustration('#d85c1b', '#c72474'),
  'guide-world-cvr-hall': illustration('#7b234d', '#db8733'),
  'guide-world-cvr-sand': illustration('#956625', '#2f7181')
}

const baseRoom = (world: ExploreWorld): ExploreRoom[] => [
  {
    platform: world.platform,
    worldId: world.worldId,
    roomId: `${world.worldId}:public-east`,
    access: 'public',
    region: world.platform === 'vrchat' ? 'us' : 'eu',
    groupName: null,
    occupancy: { state: 'complete', value: 12, source: 'visible-rooms' },
    capacity: 32,
    full: false,
    action: { state: 'available', selectionRef: `guide-selection-${world.worldRef}-east` }
  },
  {
    platform: world.platform,
    worldId: world.worldId,
    roomId: `${world.worldId}:gallery`,
    access: 'group-public',
    region: 'jp',
    groupName: 'Synthetic Stargazers',
    occupancy: { state: 'complete', value: 24, source: 'visible-rooms' },
    capacity: 24,
    full: true,
    action: { state: 'disabled', reason: 'full' }
  },
  {
    platform: world.platform,
    worldId: world.worldId,
    roomId: `${world.worldId}:quiet`,
    access: 'public',
    region: null,
    groupName: null,
    occupancy: { state: 'unknown', value: null, source: 'unknown' },
    capacity: null,
    full: null,
    action: { state: 'disabled', reason: 'unavailable' }
  }
]

export function getPlatformSnapshot(
  platform: Platform,
  mode: PlatformMode = 'ready'
): ExplorePlatformSnapshot {
  const sourceWorlds = worlds[platform]
  if (mode === 'loading') {
    return {
      platform,
      worlds: [],
      status: 'loading',
      problem: null,
      isStale: false,
      updatedAt: null
    }
  }
  if (mode === 'refreshing') {
    return {
      platform,
      worlds: sourceWorlds,
      status: 'loading',
      problem: null,
      isStale: false,
      updatedAt: Date.now()
    }
  }
  if (mode === 'error') {
    return {
      platform,
      worlds: sourceWorlds,
      status: 'error',
      problem: 'network',
      isStale: true,
      updatedAt: Date.now() - 90_000
    }
  }
  if (mode === 'stale') {
    return {
      platform,
      worlds: sourceWorlds,
      status: 'ready',
      problem: null,
      isStale: true,
      updatedAt: Date.now() - 90_000
    }
  }
  if (mode === 'empty') {
    return {
      platform,
      worlds: [],
      status: 'ready',
      problem: null,
      isStale: false,
      updatedAt: Date.now()
    }
  }
  if (mode === 'unavailable') {
    return {
      platform,
      worlds: [],
      status: 'unavailable',
      problem: 'unavailable',
      isStale: false,
      updatedAt: null
    }
  }
  return {
    platform,
    worlds: sourceWorlds,
    status: 'ready',
    problem: null,
    isStale: false,
    updatedAt: Date.now()
  }
}

export function getWorldSnapshot(
  world: ExploreWorld,
  mode: WorldMode = 'ready'
): ExploreWorldSnapshot {
  if (mode === 'loading') {
    return {
      platform: world.platform,
      world,
      rooms: [],
      roomsComplete: false,
      status: 'loading',
      problem: null,
      isStale: false,
      updatedAt: Date.now()
    }
  }
  if (mode === 'error') {
    return {
      platform: world.platform,
      world,
      rooms: baseRoom(world),
      roomsComplete: false,
      status: 'error',
      problem: 'network',
      isStale: true,
      updatedAt: Date.now() - 90_000
    }
  }
  return {
    platform: world.platform,
    world,
    rooms: baseRoom(world),
    roomsComplete: true,
    status: 'ready',
    problem: null,
    isStale: mode === 'stale',
    updatedAt: Date.now() - (mode === 'stale' ? 90_000 : 0)
  }
}

export const linkedSnapshot: LinkSnapshot = {
  lease: 'guide-only-link-lease',
  accountIds: { vrchat: 'usr-guide-owner', chilloutvr: 'cvr-guide-owner' },
  storeRevision: 4,
  profiles: [
    {
      id: 'person-guide-nyx',
      members: [
        { platform: 'vrchat', platformAccountId: 'usr-guide-owner', friendId: 'usr-guide-nyx' },
        { platform: 'chilloutvr', platformAccountId: 'cvr-guide-owner', friendId: 'cvr-guide-nyx' }
      ],
      customName: null,
      defaultName: 'Nyx Hyperion',
      preferredPlatform: 'vrchat',
      pictureMode: 'merged',
      sharedNote: 'Synthetic guide fixture; never persisted.',
      revision: 2
    }
  ]
}

export const instanceExamples: ReadonlyArray<{ platform: Platform; instance: InstanceInfo }> = [
  ...(
    [
      'public',
      'friends-plus',
      'friends',
      'invite-plus',
      'invite',
      'group-public',
      'group-plus',
      'group'
    ] as const
  ).map((type) => ({
    platform: 'vrchat' as const,
    instance: vrcInstance(type, `wrld-guide-${type}`, `VRChat ${type}`)
  })),
  ...(
    [
      'public',
      'friends-of-friends',
      'friends',
      'everyone-can-invite',
      'owner-must-invite',
      'group-public',
      'friends-of-members',
      'members-only',
      'offline'
    ] as const
  ).map((type) => ({
    platform: 'chilloutvr' as const,
    instance: cvrInstance(type, `cvr-guide-${type}`, `ChilloutVR ${type}`)
  }))
]
