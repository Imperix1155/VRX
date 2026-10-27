/**
 * Activity list values (owner, 2026-10-27): friends coming online, joining a
 * world, and going offline, on both platforms alike. Main records them from
 * the live sockets it already has; nothing here asks a platform for anything.
 *
 * ⚠️ Bundled into the RENDERER (sandboxed). Keep pure: types and values only.
 */
import type { Platform } from './types'

/** What happened. Display order, which is also the filter order on the page. */
export const ACTIVITY_KINDS = ['online', 'world', 'offline'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** The Activity page's Show filter: everything, or one kind. Display order. */
export const ACTIVITY_FILTERS = ['all', ...ACTIVITY_KINDS] as const
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

export interface ActivityEntry {
  /** Main-issued and increasing within one app run; newer entries are larger. */
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
