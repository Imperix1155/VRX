import type { Platform } from './types'

/** Display-only discovery values. Main owns access evidence and action authority. */
export const EXPLORE_WORLD_TOTALS = [2, 4, 6] as const
export type ExploreWorldTotal = (typeof EXPLORE_WORLD_TOTALS)[number]
export const DEFAULT_EXPLORE_WORLD_TOTAL: ExploreWorldTotal = 4
export type ExploreFilter = 'all' | Platform

export type ExploreCountSource =
  | 'vrc-world-occupants'
  | 'vrc-world-tuple'
  | 'vrc-room-n-users'
  | 'vrc-room-user-count'
  | 'cvr-room-current-player-count'
  | 'cvr-public-rooms'
  | 'visible-rooms'
  | 'unknown'

/** Partial coverage never presents its subtotal as a complete display count. */
export type ExploreCount =
  | { state: 'complete'; value: number; source: ExploreCountSource }
  | { state: 'partial' | 'unknown'; value: null; source: ExploreCountSource }

export interface ExploreWorld {
  platform: Platform
  worldId: string
  /** Opaque reference issued by main in phase B; fixtures use synthetic references. */
  worldRef: string
  name: string
  thumbnailUrl: string | null
  activity: ExploreCount
  visibleRoomCount: ExploreCount
  popularity: number | null
  /** Stable source order for CVR candidates whose public totals are incomplete. */
  sourceOrder: number
}

export type ExplorePublicAccess = 'public' | 'group-public'
export type ExploreJoinDenial =
  'full' | 'restricted' | 'unavailable' | 'unknown' | 'stale' | 'busy' | 'joining-disabled'

export type ExploreRoomAction =
  { state: 'available'; selectionRef: string } | { state: 'disabled'; reason: ExploreJoinDenial }

export interface ExploreRoom {
  platform: Platform
  worldId: string
  roomId: string
  access: ExplorePublicAccess
  region: string | null
  groupName: string | null
  occupancy: ExploreCount
  capacity: number | null
  full: boolean | null
  action: ExploreRoomAction
}

type ExploreLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
type ExploreProblem = 'network' | 'rate-limited' | 'invalid-data' | 'unavailable'

interface ExploreLoadState {
  status: ExploreLoadStatus
  problem: ExploreProblem | null
  isStale: boolean
  updatedAt: number | null
}

export interface ExplorePlatformSnapshot extends ExploreLoadState {
  platform: Platform
  worlds: readonly ExploreWorld[]
}

export interface ExploreWorldSnapshot extends ExploreLoadState {
  platform: Platform
  world: ExploreWorld
  rooms: readonly ExploreRoom[]
  roomsComplete: boolean
}
