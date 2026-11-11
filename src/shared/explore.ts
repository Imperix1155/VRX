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

/** Bounds for the world details a sheet lists under Show more. */
export const EXPLORE_ABOUT_CREATOR_MAX = 64
export const EXPLORE_ABOUT_DESCRIPTION_MAX = 2_048
export const EXPLORE_ABOUT_MAX_TAGS = 12
export const EXPLORE_ABOUT_TAG_MAX = 32

/**
 * What the world's own page says about it. Display only: every field comes
 * from the same world read that lists the rooms, so it costs no request, and
 * a field the platform doesn't give is null (or no tags).
 */
export interface ExploreWorldAbout {
  creator: string | null
  description: string | null
  tags: readonly string[]
  /** Most people one room of this world holds, when the platform says. */
  capacity: number | null
}

/** Marks that turn the reading direction of the text after them. */
const DIRECTION_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
/** Control characters other than a line break. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g

/**
 * Cleans one piece of world text and trims it to a bound by code point,
 * ending in "…" when it was cut. Direction marks are dropped so one value
 * cannot turn the text beside it around. `lines` keeps the creator's line
 * breaks (at most one blank line in a row); otherwise the text is one line.
 * Blank or non-text becomes null.
 */
function aboutText(value: unknown, max: number, lines = false): string | null {
  if (typeof value !== 'string') return null
  const plain = value.replace(DIRECTION_MARKS, '').replace(/\r\n?/g, '\n')
  const cleaned = (
    lines
      ? plain.replace(CONTROL_CHARACTERS, ' ').replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
      : plain.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned === '') return null
  const points = Array.from(cleaned)
  return points.length <= max
    ? cleaned
    : `${points
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

/** Bounds untrusted world details. Unknown shapes become null or no tags. */
export function exploreWorldAbout(raw: {
  creator: unknown
  description: unknown
  tags: unknown
  capacity: unknown
}): ExploreWorldAbout {
  const tags: string[] = []
  if (Array.isArray(raw.tags)) {
    const seen = new Set<string>()
    for (const entry of raw.tags) {
      if (tags.length >= EXPLORE_ABOUT_MAX_TAGS) break
      const tag = aboutText(entry, EXPLORE_ABOUT_TAG_MAX)
      if (tag === null || seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      tags.push(tag)
    }
  }
  return {
    creator: aboutText(raw.creator, EXPLORE_ABOUT_CREATOR_MAX),
    description: aboutText(raw.description, EXPLORE_ABOUT_DESCRIPTION_MAX, true),
    tags,
    capacity:
      typeof raw.capacity === 'number' && Number.isSafeInteger(raw.capacity) && raw.capacity > 0
        ? raw.capacity
        : null
  }
}

export interface ExploreWorldSnapshot extends ExploreLoadState {
  platform: Platform
  world: ExploreWorld
  rooms: readonly ExploreRoom[]
  roomsComplete: boolean
  /** Absent or null until the world's own details have been read. */
  about?: ExploreWorldAbout | null
}
