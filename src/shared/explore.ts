import type { Platform } from './types'

/** Display-only discovery values. Main owns access evidence and action authority. */
export const EXPLORE_WORLD_TOTALS = [2, 4, 6] as const
export type ExploreWorldTotal = (typeof EXPLORE_WORLD_TOTALS)[number]
export const DEFAULT_EXPLORE_WORLD_TOTAL: ExploreWorldTotal = 4
/** Most worlds one selection may hold: six rows on the widest (eight-column) window. */
export const EXPLORE_MAX_SELECTION = 48
export type ExploreFilter = 'all' | Platform
export type ExploreRefreshReason = 'snapshot' | 'automatic' | 'manual'
export type ExploreWorldReason = 'snapshot' | 'open' | 'manual'

/** Main owns image admission. Only a typed admission deferral is recoverable. */
/**
 * A deferred picture says why: `busy` (other pictures are downloading; a short
 * wait) or `window` (the per-minute download budget is used up).
 */
export type ExploreImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'deferred'; retryAfterMs: number; wait?: 'busy' | 'window' }
  | null

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
  /** Opaque reference issued by main; fixtures use synthetic references. */
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

/**
 * ISO 639-1 codes VRX will name for a VRChat instance's `dominantLanguage`.
 * Anything else stays hidden: a raw code is not a label.
 */
export const EXPLORE_SPOKEN_LANGUAGES = [
  'ar',
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh'
] as const
export type ExploreSpokenLanguage = (typeof EXPLORE_SPOKEN_LANGUAGES)[number]

/** Code-point caps for instance copy that crosses into the renderer. */
export const EXPLORE_INSTANCE_TITLE_MAX = 80
export const EXPLORE_INSTANCE_DESCRIPTION_MAX = 280

const SPOKEN_LANGUAGE_SET: ReadonlySet<string> = new Set(EXPLORE_SPOKEN_LANGUAGES)

/** A known spoken-language code, or null. Matching is case-insensitive and exact. */
export function exploreSpokenLanguage(value: string): ExploreSpokenLanguage | null {
  const code = value.trim().toLowerCase()
  return SPOKEN_LANGUAGE_SET.has(code) ? (code as ExploreSpokenLanguage) : null
}

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
  /**
   * User-chosen instance name from a room response. Plain text, never a chip.
   * Null when the platform omitted it. ChilloutVR has no equivalent.
   */
  instanceTitle: string | null
  /** Instance description, already clipped. Null when omitted. */
  instanceDescription: string | null
  /** Spoken language the instance named, or null when missing or unrecognized. */
  spokenLanguage: ExploreSpokenLanguage | null
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
