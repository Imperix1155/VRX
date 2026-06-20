import type { AuthStatus, Friend, InstanceInfo, LoginResult, Platform } from '@shared/types'
import type { IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'

const FAKE_INSTANCE: InstanceInfo = {
  worldId: 'wrld_fake_001',
  instanceId: 'wrld_fake_001:12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  region: 'us',
  userCount: 12
}

const FAKE_FRIENDS: Friend[] = [
  {
    platformUserId: 'usr_fake_001',
    platform: 'vrchat',
    displayName: 'Kitsune_Rei',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'join-me',
    statusDescription: 'Come hang out!',
    instance: FAKE_INSTANCE,
    trustRank: 'trusted',
    isFavorite: true,
    favoriteGroupIds: [],
    linkedPersonId: null
  },
  {
    platformUserId: 'usr_fake_002',
    platform: 'vrchat',
    displayName: 'NebulaDrifter',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    instance: {
      ...FAKE_INSTANCE,
      worldId: 'wrld_fake_002',
      instanceId: 'wrld_fake_002:99999~friends',
      worldName: 'Midnight Rooftop',
      type: 'friends',
      openness: 'friends',
      userCount: 3
    },
    trustRank: 'known',
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  },
  {
    platformUserId: 'usr_fake_003',
    platform: 'vrchat',
    displayName: 'PixelWitch',
    avatarUrl: null,
    presence: { state: 'active' },
    status: 'online',
    statusDescription: 'brb',
    instance: null,
    trustRank: 'user',
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  },
  {
    platformUserId: 'usr_fake_004',
    platform: 'vrchat',
    displayName: 'SolarFoxVR',
    avatarUrl: null,
    presence: { state: 'offline' },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: 'trusted',
    isFavorite: true,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
]

/** Development stub — returns hardcoded friends so the UI can be built before the real VRChat adapter lands. */
export class FakeVrcAdapter implements IPlatformAdapter {
  readonly platform: Platform = 'vrchat'

  getAuthStatus(): Promise<AuthStatus> {
    return Promise.resolve({ platform: 'vrchat', state: 'authenticated', displayName: 'DevUser' })
  }

  login(): Promise<LoginResult> {
    return Promise.resolve({ ok: true })
  }

  importSession(): Promise<boolean> {
    return Promise.resolve(false)
  }

  getFriends(): Promise<Friend[]> {
    return Promise.resolve(FAKE_FRIENDS)
  }

  getInstanceDetails(): Promise<InstanceInfo> {
    return Promise.resolve(FAKE_INSTANCE)
  }

  joinInstance(): Promise<void> {
    return Promise.resolve()
  }

  selfInvite(): Promise<void> {
    return Promise.resolve()
  }

  subscribe(): Unsubscribe {
    return () => {}
  }
}
