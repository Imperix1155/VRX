import type { InboxItem, InboxSnapshot } from '@shared/inbox'
import type { CommunityGroup, PersonProfile, PersonSummary } from '@shared/community'
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
import type { ActivityEntry } from '@shared/activity'
import type { AvatarItem } from '@shared/avatarLibrary'

export type PlatformMode =
  'ready' | 'loading' | 'refreshing' | 'error' | 'stale' | 'empty' | 'unavailable'
type WorldMode = 'ready' | 'loading' | 'error' | 'stale'

function illustration(first: string, second: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="560" viewBox="0 0 1280 560"><defs><linearGradient id="sky" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="28"/></filter></defs><rect width="1280" height="560" fill="url(#sky)"/><circle cx="1080" cy="106" r="172" fill="#fff" fill-opacity=".16" filter="url(#blur)"/><path d="M0 405 C190 300 280 475 470 365 S735 305 880 405 S1100 300 1280 390 V560 H0Z" fill="#060917" fill-opacity=".44"/><path d="M0 445 C245 355 370 515 585 405 S940 344 1280 445 V560 H0Z" fill="#02030a" fill-opacity=".4"/><g fill="#fff" fill-opacity=".52"><circle cx="100" cy="274" r="5"/><circle cx="188" cy="231" r="3"/><circle cx="272" cy="284" r="4"/><circle cx="764" cy="181" r="4"/><circle cx="870" cy="242" r="3"/><circle cx="1130" cy="302" r="5"/></g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Synthetic stand-in for a user's own background picture (Settings → Appearance). */
export const backgroundPicture = illustration('#5b3fa6', '#0e7c86')

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

/** Sample Activity list, newest first. Ask Me / DND friends never name a world,
 *  and the oldest rows fall on the previous day to show the date form. Times
 *  are relative to the moment the scene loads. */
export function activityEntries(now: number): ActivityEntry[] {
  const minute = 60_000
  const rows: Array<Omit<ActivityEntry, 'id' | 'at'> & { ago: number }> = [
    {
      kind: 'world',
      platform: 'vrchat',
      platformUserId: 'usr-guide-iris',
      displayName: 'Iris Circuitbreaker',
      worldName: 'Aurora Transit Lounge',
      ago: 1
    },
    {
      kind: 'online',
      platform: 'chilloutvr',
      platformUserId: 'cvr-guide-pixel',
      displayName: 'Pixel Orchard',
      worldName: 'Midnight Museum of Small Wonders (#816332)',
      ago: 3
    },
    {
      kind: 'offline',
      platform: 'vrchat',
      platformUserId: 'usr-guide-sol',
      displayName: 'Sol in a Very Long Display Name That Truncates Gracefully',
      worldName: null,
      ago: 6
    },
    {
      kind: 'world',
      platform: 'chilloutvr',
      platformUserId: 'cvr-guide-marlow',
      displayName: 'Marlow, Archive Keeper',
      worldName: 'Aurora Transit Lounge',
      ago: 9
    },
    {
      kind: 'online',
      platform: 'vrchat',
      platformUserId: 'usr-guide-vale',
      displayName: 'Vale After the Last Train',
      worldName: null,
      ago: 14
    },
    {
      kind: 'offline',
      platform: 'chilloutvr',
      platformUserId: 'cvr-guide-delta',
      displayName: 'Delta Frame',
      worldName: null,
      ago: 22
    },
    {
      kind: 'online',
      platform: 'vrchat',
      platformUserId: 'usr-guide-kai',
      displayName: 'Kai',
      worldName: null,
      ago: 31
    },
    {
      kind: 'world',
      platform: 'chilloutvr',
      platformUserId: 'cvr-guide-fern',
      displayName: 'Fern',
      worldName: null,
      ago: 40
    },
    {
      kind: 'online',
      platform: 'vrchat',
      platformUserId: 'usr-guide-nyx',
      displayName: 'Nyx “Long Name” Hyperion-Santos',
      worldName: 'Aurora Transit Lounge',
      ago: 26 * 60
    },
    {
      kind: 'online',
      platform: 'chilloutvr',
      platformUserId: 'cvr-guide-gone',
      displayName: 'Former Friend',
      worldName: null,
      ago: 27 * 60
    }
  ]
  return rows.map(({ ago, ...row }, index) => ({
    ...row,
    id: rows.length - index,
    at: now - ago * minute
  }))
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

/**
 * Synthetic inbox rows: one of each kind across both platforms, from sample
 * friends so their pictures show, plus a non-friend request. Times are offsets
 * from the moment the scene opens.
 */
export function inboxSample(now: number): InboxSnapshot {
  const vrc = friends.vrchat[0]
  const cvr = friends.chilloutvr[0]
  const items: InboxItem[] = []
  if (vrc)
    items.push({
      id: 'invite:not_fixture_1',
      platform: 'vrchat',
      kind: 'invite',
      senderId: vrc.platformUserId,
      senderName: vrc.displayName,
      worldName: 'Moonlit Observatory',
      receivedAt: now - 4 * 60_000
    })
  if (cvr)
    items.push({
      id: 'invite-request:fixture-req-1',
      platform: 'chilloutvr',
      kind: 'invite-request',
      senderId: cvr.platformUserId,
      senderName: cvr.displayName,
      worldName: null,
      receivedAt: now - 25 * 60_000
    })
  items.push(
    {
      id: 'friend-request:fixture-guest-1',
      platform: 'chilloutvr',
      kind: 'friend-request',
      senderId: 'fixture-guest-1',
      senderName: 'Pixel Wanderer',
      worldName: null,
      receivedAt: now - 20_000
    },
    {
      id: 'friend-request:not_fixture_2',
      platform: 'vrchat',
      kind: 'friend-request',
      senderId: 'usr_fixture_guest_2',
      senderName: 'Starlight Courier',
      worldName: null,
      receivedAt: now - 2 * 60 * 60_000
    }
  )
  items.sort((a, b) => b.receivedAt - a.receivedAt)
  return { items }
}

/** A simple standing figure on a soft gradient: a stand-in avatar picture. */
function avatarPicture(first: string, second: string, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient></defs><rect width="640" height="480" fill="url(#bg)"/><circle cx="320" cy="150" r="62" fill="${body}"/><path d="M220 470c0-120 40-210 100-210s100 90 100 210Z" fill="${body}"/><circle cx="296" cy="146" r="8" fill="#0b0d1a"/><circle cx="344" cy="146" r="8" fill="#0b0d1a"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function sampleAvatar(
  platform: Platform,
  index: number,
  name: string,
  colors: [string, string, string],
  details: Partial<AvatarItem> = {}
): AvatarItem {
  const suffix = String(index).padStart(12, '0')
  const guid = `5a3c1e2d-0000-4000-8000-${suffix}`
  return {
    platform,
    avatarId: platform === 'vrchat' ? `avtr_${guid}` : guid,
    name,
    description: null,
    imageUrl: avatarPicture(...colors),
    authorName: 'Guide visitor',
    visibility: 'private',
    createdAt: '2026-03-14T12:00:00.000Z',
    updatedAt: '2026-10-02T18:30:00.000Z',
    ...details
  }
}

const vrcAvatars: AvatarItem[] = [
  sampleAvatar('vrchat', 1, 'Lumen Fox', ['#2b4ea8', '#7a5cf0', '#f2c38b'], {
    description: 'Everyday avatar with a soft glow tail and three outfits.',
    visibility: 'public'
  }),
  sampleAvatar('vrchat', 2, 'Night Runner', ['#0f2a4a', '#1b7f9c', '#cfd8e6']),
  sampleAvatar('vrchat', 3, 'Paper Crane', ['#3a3f5c', '#c86f8f', '#f6efe6'], {
    updatedAt: '2026-08-21T09:00:00.000Z'
  }),
  sampleAvatar('vrchat', 4, 'Moss Golem (Quest test)', ['#203b2a', '#5f8f4a', '#a7c48a'])
]

const cvrAvatars: AvatarItem[] = [
  sampleAvatar('chilloutvr', 11, 'Ember Synth', ['#5a1f12', '#d9752b', '#ffd6a5'], {
    description: 'Club avatar with toggles for jacket, visor and glow.',
    visibility: 'public'
  }),
  sampleAvatar('chilloutvr', 12, 'Harbor Otter', ['#183847', '#3f8a9a', '#c9a27e']),
  sampleAvatar('chilloutvr', 13, 'Copper Knight', ['#2e2620', '#a5652d', '#d8c3a5'], {
    updatedAt: '2026-07-30T20:15:00.000Z'
  })
]

/** The Avatars page's synthetic libraries: the first avatar is worn on each platform. */
export const avatarLibraries: Record<Platform, AvatarItem[]> = {
  vrchat: vrcAvatars,
  chilloutvr: cvrAvatars
}

/** Sample groups for the Groups page: owned and member groups on both platforms. */
export const communityGroups: Record<Platform, CommunityGroup[]> = {
  vrchat: [
    {
      platform: 'vrchat',
      groupId: 'grp-guide-lantern',
      name: 'Lantern Walkers',
      code: 'LANTN.4821',
      description:
        'Slow walks through quiet worlds every Friday night. Bring a light, leave the music low.',
      imageUrl: illustration('#1b6fd8', '#0a2a5c'),
      bannerUrl: illustration('#2b7de9', '#08193a'),
      memberCount: 1284,
      role: 'owner'
    },
    {
      platform: 'vrchat',
      groupId: 'grp-guide-atlas',
      name: 'Atlas of Tiny Worlds and Very Long Group Names',
      code: 'ATLAS.0007',
      description: null,
      imageUrl: illustration('#3d8bfd', '#13244a'),
      bannerUrl: null,
      memberCount: 56210,
      role: 'member'
    }
  ],
  chilloutvr: [
    {
      platform: 'chilloutvr',
      groupId: 'cvr-group-guide-forge',
      name: 'Prop Forge',
      code: 'FORGE',
      description: 'Makers sharing props, shaders and avatar bits.',
      imageUrl: illustration('#f07d1a', '#5a2405'),
      bannerUrl: illustration('#ff9a3c', '#3b1503'),
      memberCount: 342,
      role: 'member'
    },
    {
      platform: 'chilloutvr',
      groupId: 'cvr-group-guide-harbor',
      name: 'Harbor Night Market',
      code: 'HRBR',
      description: 'A weekly market in the harbor world.',
      imageUrl: illustration('#e86a12', '#47210a'),
      bannerUrl: null,
      memberCount: 97,
      role: 'owner'
    }
  ]
}

/** The full profile of a sample friend: the same fields on both platforms. */
export function profileFor(platform: Platform, userId: string): PersonProfile | null {
  const friend = friends[platform].find((item) => item.platformUserId === userId)
  if (!friend) return null
  return {
    platform,
    userId,
    displayName: friend.displayName,
    imageUrl: friend.avatarUrl,
    isFriend: true,
    pronouns: platform === 'vrchat' ? 'they/them' : null,
    bio: 'Builds small worlds and collects sunsets.\nUsually around in the evening.',
    rank:
      platform === 'vrchat'
        ? { kind: 'vrchat-trust', value: 'trusted' }
        : { kind: 'label', value: 'User' },
    badges:
      platform === 'vrchat'
        ? [
            { name: 'VRChat+ Supporter', imageUrl: null },
            { name: 'Early Adopter', imageUrl: null }
          ]
        : [{ name: 'Community Helper', imageUrl: null }]
  }
}

/** People a sample search finds: two friends per platform. */
export function searchPeople(platform: Platform): PersonSummary[] {
  return friends[platform].slice(0, 3).map((friend, index) => ({
    platform,
    userId: friend.platformUserId,
    displayName: friend.displayName,
    imageUrl: friend.avatarUrl,
    isFriend: index < 2
  }))
}
