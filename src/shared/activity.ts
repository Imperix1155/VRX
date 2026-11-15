/**
 * Activity list values (owner, 2026-10-27): friends coming online, joining a
 * world, and going offline, on both platforms alike. Main records them from
 * the live sockets it already has; nothing here asks a platform for anything.
 * Since 2026-11-15 (owner) main also saves them on this computer, per account,
 * for as long as the Keep activity for setting says.
 *
 * ⚠️ Bundled into the RENDERER (sandboxed). Keep pure: types and values only.
 */
import type { Platform } from './types'

/** What happened. Display order, which is also the filter order on the page. */
const ACTIVITY_KINDS = ['online', 'world', 'offline'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** The Activity page's Show filter: everything, or one kind. Display order. */
export const ACTIVITY_FILTERS = ['all', ...ACTIVITY_KINDS] as const
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

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
   *  friends set to Ask Me or Do Not Disturb, and for going offline. */
  worldName: string | null
  /** Wall-clock time in ms since the epoch. */
  at: number
}
