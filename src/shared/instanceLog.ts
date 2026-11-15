/**
 * The instance log (owner, 2026-11-15): the rooms the signed-in user has been
 * in and who was there with them, saved on this computer only. VRChat's comes
 * from the game's own log file on this computer; ChilloutVR's from the live
 * connection VRX already holds. One shape for both platforms.
 */
import type { Platform } from './types'

/** One stay in one room. */
export interface InstanceVisit {
  id: number
  platform: Platform
  /** Null when the game did not name the world. */
  worldName: string | null
  enteredAt: number
  /** Null while the user is still there, or when the end was never seen. */
  leftAt: number | null
  /** True for the room the user is in right now. */
  current: boolean
  /** Different people seen there, the user not counted. */
  people: number
}

/** Where a page of visits starts for one platform: before this visit's entry
 *  time, or null for the newest. */
export interface InstanceVisitCursor {
  platform: Platform
  before: number | null
}

export interface InstanceVisitPageRequest {
  scope: InstanceVisitCursor[]
}

export interface InstanceVisitPage {
  visits: InstanceVisit[]
  hasMore: boolean
}

/** One person in one visit. */
export interface InstanceVisitPerson {
  platformUserId: string
  displayName: string
  joinedAt: number
  /** Null while they are still there, or when their leaving was never seen. */
  leftAt: number | null
}

/** What the instance log says about one person. */
export interface MetFacts {
  /** Visits they shared with the user. */
  times: number
  /** Time in the same room, in ms. Stays still open count for nothing yet. */
  togetherMs: number
  /** When they were last in the same room. */
  lastAt: number
  lastWorldName: string | null
}

/** Most people listed for one visit. */
export const INSTANCE_VISIT_PEOPLE_MAX = 200
/** Visits read per page. */
export const INSTANCE_VISIT_PAGE_SIZE = 50
