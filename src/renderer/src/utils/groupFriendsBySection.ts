import type { Friend, FriendSection, PresenceState } from '@shared/types'

/** Section display order (VRX-67): In-Game → Online → Offline. */
export const FRIEND_SECTION_ORDER: readonly FriendSection[] = ['in-game', 'online', 'offline']

/**
 * Maps a friend's presence STATE to its list section — distinct from
 * `PresenceState` itself: `active` (web/desktop, not in a world) displays as
 * the "online" section (DESIGN.md §5 — state vs status stay separate axes).
 */
const SECTION_BY_PRESENCE_STATE: Record<PresenceState, FriendSection> = {
  'in-game': 'in-game',
  active: 'online',
  offline: 'offline'
}

export interface FriendSectionGroup {
  section: FriendSection
  friends: Friend[]
}

/**
 * Groups friends into the three presence sections (VRX-67), in
 * `FRIEND_SECTION_ORDER`, alphabetical within each section — the same
 * comparator the pre-VRX-67 flat online-first ordering used. Sections
 * SUPERSEDE that flat ordering; this is the only sort applied to the list now.
 */
export function groupFriendsBySection(friends: Friend[]): FriendSectionGroup[] {
  const buckets: Record<FriendSection, Friend[]> = { 'in-game': [], online: [], offline: [] }
  for (const friend of friends) {
    buckets[SECTION_BY_PRESENCE_STATE[friend.presence.state]].push(friend)
  }
  for (const section of FRIEND_SECTION_ORDER) {
    buckets[section].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    )
  }
  return FRIEND_SECTION_ORDER.map((section) => ({ section, friends: buckets[section] }))
}
