import type { Friend } from './types'

const HIDDEN_WORLD_IDS = new Set(['', 'private', 'offline', 'traveling'])

/** Shared, platform-neutral gate used before any friend-instance action. */
export function isFriendJoinable(friend: Friend): boolean {
  if (friend.presence.state !== 'in-game' || friend.instance === null) return false
  if (HIDDEN_WORLD_IDS.has(friend.instance.worldId)) return false
  return friend.platform !== 'chilloutvr' || friend.instance.type !== 'offline'
}
