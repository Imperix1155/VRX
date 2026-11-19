/**
 * Activity list values (owner, 2026-10-27): friends coming online, joining a
 * world, and going offline, on both platforms alike. Main records them from
 * the live sockets it already has; nothing here asks a platform for anything.
 * Since 2026-11-15 (owner) main also saves them on this computer, per account,
 * for as long as the Keep activity for setting says.
 *
 * ⚠️ Bundled into the RENDERER (sandboxed). Keep pure: types and values only.
 */
import type { MetFacts } from './instanceLog'
import type { Platform } from './types'

/** Where a friend is: coming online, joining a world, going offline. */
const PRESENCE_KINDS = ['online', 'world', 'offline'] as const
/** The friends list itself changing (owner, 2026-11-15): a new friend, someone
 *  no longer on the list, a friend's new name. */
export const FRIEND_LIST_KINDS = ['added', 'removed', 'renamed'] as const
export type FriendListKind = (typeof FRIEND_LIST_KINDS)[number]

/** What happened. */
export const ACTIVITY_KINDS = [...PRESENCE_KINDS, ...FRIEND_LIST_KINDS] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** The Activity page's Show filter: everything, one presence kind, or the
 *  friends list changes together. Display order. */
export const ACTIVITY_FILTERS = ['all', ...PRESENCE_KINDS, 'friends'] as const
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

/** The kinds a Show filter lists; null lists every kind. */
export function activityKindsOf(filter: ActivityFilter): readonly ActivityKind[] | null {
  if (filter === 'all') return null
  if (filter === 'friends') return FRIEND_LIST_KINDS
  return [filter]
}

/** Whether an entry is listed under a Show filter. */
export function matchesActivityFilter(kind: ActivityKind, filter: ActivityFilter): boolean {
  const kinds = activityKindsOf(filter)
  return kinds === null || kinds.includes(kind)
}

/** How long saved activity stays on this computer. `session` saves nothing:
 *  the list lasts until VRX closes, as it did before saving existed. */
export const ACTIVITY_KEEP_FOR = ['session', '30d', '90d', '1y', 'forever'] as const
export type ActivityKeepFor = (typeof ACTIVITY_KEEP_FOR)[number]

/** Days each choice keeps; null keeps without an age limit. `session` has no
 *  entry on purpose: it saves nothing. */
export const ACTIVITY_KEEP_DAYS: Record<Exclude<ActivityKeepFor, 'session'>, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  forever: null
}

/**
 * Whether changing the Keep activity for choice from `current` to `next`
 * deletes anything saved. The choices are listed shortest first, and "until
 * VRX closes" saves nothing, so every earlier choice is a shorter one. The
 * Activity page asks before applying such a change.
 */
export function deletesSavedHistory(current: ActivityKeepFor, next: ActivityKeepFor): boolean {
  return ACTIVITY_KEEP_FOR.indexOf(next) < ACTIVITY_KEEP_FOR.indexOf(current)
}

/** One friend, as the renderer names them to main. */
export interface ActivityFriendRef {
  platform: Platform
  friendId: string
}

/** Where one platform's page starts. */
export interface ActivityPageCursor {
  platform: Platform
  /** Entries older than this one; null starts at the newest. */
  beforeId: number | null
}

/** Older saved activity, one page at a time. */
export interface ActivityPageRequest {
  /** One or both platforms, each from its own place, so two platforms with
   *  different amounts loaded continue without a gap or a repeat. Only the
   *  signed-in accounts are ever read. */
  scope: ActivityPageCursor[]
  filter: ActivityFilter
  /** Only these friends (one, or a linked person's two accounts). */
  friends?: ActivityFriendRef[]
}

/**
 * What VRX knows about one friendship from its own saved history (owner,
 * 2026-11-15). Neither platform says when a friendship began, so `since` is
 * the day VRX saw it begin, or, for someone already a friend when history
 * started, that first day (`sinceKnown` false: "since before").
 */
export interface FriendListFacts {
  platform: Platform
  friendId: string
  /** Ms since the epoch, or null when nothing is saved for this friend. */
  since: number | null
  sinceKnown: boolean
  /** Names they used before, newest change first. */
  previousNames: Array<{ name: string; until: number }>
}

export interface ActivityPage {
  /** Newest first. */
  entries: ActivityEntry[]
  /** Whether older entries than these exist in the same scope. */
  hasMore: boolean
}

export interface ActivityEntry {
  /** Main-issued and increasing, across restarts too; newer entries are larger. */
  id: number
  kind: ActivityKind
  platform: Platform
  platformUserId: string
  /** The name the friend had when it happened. */
  displayName: string
  /** The world they came online in or joined, when known. Always null for
   *  friends set to Ask Me or Do Not Disturb, and for every other kind. */
  worldName: string | null
  /** `renamed` only: the name they had before. */
  previousName?: string
  /** Wall-clock time in ms since the epoch. */
  at: number
}

/** Everything VRX has saved about one friend: the friends list history and
 *  what the instance log says (null when they were never seen in a room). */
export interface FriendHistoryFacts extends FriendListFacts {
  met: MetFacts | null
}
