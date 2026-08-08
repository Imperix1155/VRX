import type { Friend } from '@shared/types'

/**
 * Schema-complete, platform-true Friend fixture for persisted-cache tests.
 * Typed as Friend WITHOUT a cast so the compiler keeps it in sync with the
 * real type — the persisted-cache deserializer validates strictly, and a
 * platform-wrong field (e.g. a VRChat presence on a CVR friend) makes the
 * whole envelope discard (CVR presence allows only 'in-game' | 'offline').
 */
export function fullFriend(name: string, platform: Friend['platform']): Friend {
  const base = {
    platformUserId: `usr_${name.toLowerCase().replace(/\s+/g, '_')}`,
    displayName: name,
    avatarUrl: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  if (platform === 'chilloutvr') {
    return {
      ...base,
      platform,
      presence: { state: 'in-game' },
      status: null,
      statusDescription: null,
      trustRank: null
    }
  }
  return {
    ...base,
    platform,
    presence: { state: 'active' },
    status: null,
    statusDescription: null,
    trustRank: null
  }
}
