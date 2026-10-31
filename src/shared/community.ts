/**
 * Read-only community lookups: a person's full profile, search for people and
 * worlds, the New and Recently updated world lists, the player count on each
 * platform, and the signed-in user's groups. Nothing here changes anything on
 * a platform account, and every read starts from a user action.
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */
import type { ExploreWorld } from './explore'
import type { Platform, TrustRank } from './types'

/** Longest search text main sends. */
export const COMMUNITY_QUERY_MAX_LENGTH = 64
/** Shortest search text main sends; one letter matches far too much. */
export const COMMUNITY_QUERY_MIN_LENGTH = 2
/** Most people and most worlds a search keeps per platform. */
export const COMMUNITY_SEARCH_MAX_RESULTS = 10
/** Most worlds a New or Recently updated list keeps per platform. */
export const COMMUNITY_LIST_MAX_WORLDS = 12
/** Most public worlds or groups a profile lists. */
export const COMMUNITY_PROFILE_MAX_ITEMS = 24
/** Most of the user's own groups listed per platform. */
export const COMMUNITY_MY_GROUPS_MAX = 200
/** Most badges a profile shows. */
export const COMMUNITY_MAX_BADGES = 8
/** Longest name, bio or description kept from a platform reply. */
export const COMMUNITY_TEXT_MAX_LENGTH = 2_048
/** How long a read is reused before a new one may go out (5 minutes). */
export const COMMUNITY_CACHE_MS = 5 * 60_000
/** Spacing between two searches on one platform (a human-paced action). */
export const COMMUNITY_SEARCH_COOLDOWN_MS = 2_000

/** The Explore lists besides Popular now. Both platforms offer both. */
export const WORLD_LISTS = ['new', 'updated'] as const
export type WorldList = (typeof WORLD_LISTS)[number]

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const VRC_USER_ID = new RegExp(`^usr_${GUID}$`, 'i')
// Some early VRChat accounts keep a short legacy ID; accept only plain letters
// and digits so nothing else can reach a request path.
const VRC_LEGACY_USER_ID = /^[A-Za-z0-9]{6,32}$/
const CVR_USER_ID = new RegExp(`^${GUID}$`, 'i')

/** Shape check only. Main still reads a profile only for someone it knows. */
export function isCommunityUserId(platform: Platform, value: unknown): value is string {
  if (typeof value !== 'string') return false
  return platform === 'vrchat'
    ? VRC_USER_ID.test(value) || VRC_LEGACY_USER_ID.test(value)
    : CVR_USER_ID.test(value)
}

/** Search text as main sends it: trimmed, inner spaces collapsed, or null when unusable. */
export function normalizeCommunityQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const query = value.trim().replace(/\s+/g, ' ')
  if (query.length < COMMUNITY_QUERY_MIN_LENGTH || query.length > COMMUNITY_QUERY_MAX_LENGTH)
    return null
  return query
}

/** A person as a search lists them. */
export interface PersonSummary {
  platform: Platform
  userId: string
  displayName: string
  /** An image URL for `get-avatar`; main's image proxy allowlists its host. */
  imageUrl: string | null
  /** True when they are on the signed-in user's friends list; null when not said. */
  isFriend: boolean | null
}

export interface ProfileBadge {
  name: string
  imageUrl: string | null
}

/** VRChat's trust rank, or the rank word ChilloutVR shows (for example "Moderator"). */
export type ProfileRank =
  { kind: 'vrchat-trust'; value: NonNullable<TrustRank> } | { kind: 'label'; value: string }

export interface PersonProfile extends PersonSummary {
  pronouns: string | null
  bio: string | null
  rank: ProfileRank | null
  badges: ProfileBadge[]
}

/** A world a person made, shown in their profile. Display only. */
export interface CommunityWorld {
  platform: Platform
  worldId: string
  name: string
  imageUrl: string | null
}

export interface CommunityGroup {
  platform: Platform
  groupId: string
  name: string
  /** VRChat's short code (ABCDE.1234) or ChilloutVR's tag; null when not said. */
  code: string | null
  description: string | null
  imageUrl: string | null
  bannerUrl: string | null
  memberCount: number | null
  /** The signed-in user's place in their own groups; null in someone else's list. */
  role: 'owner' | 'member' | null
}

export type CommunityFailure = 'not-authenticated' | 'rate-limited' | 'unavailable'

export type ProfileResult =
  | { ok: true; profile: PersonProfile }
  | { ok: false; reason: CommunityFailure | 'unknown-person' | 'not-found' }

export type ProfileWorldsResult =
  | { ok: true; worlds: CommunityWorld[]; complete: boolean }
  | { ok: false; reason: CommunityFailure | 'unknown-person' }

export type ProfileGroupsResult =
  | { ok: true; groups: CommunityGroup[]; complete: boolean }
  | { ok: false; reason: CommunityFailure | 'unknown-person' }

export type CommunitySearchResult =
  | {
      ok: true
      platform: Platform
      query: string
      people: PersonSummary[]
      /** Each carries a main-issued `worldRef` that opens the Explore world sheet. */
      worlds: ExploreWorld[]
    }
  | { ok: false; reason: CommunityFailure | 'cooldown' | 'invalid-query' }

export type WorldListResult =
  | { ok: true; platform: Platform; list: WorldList; worlds: ExploreWorld[] }
  | { ok: false; reason: CommunityFailure }

export type PlayersOnlineResult =
  | {
      ok: true
      platform: Platform
      count: number
      /** Main's wall-clock ms when the platform answered. */
      checkedAt: number
    }
  | { ok: false; reason: CommunityFailure }

export type MyGroupsResult =
  | { ok: true; platform: Platform; groups: CommunityGroup[]; complete: boolean }
  | { ok: false; reason: CommunityFailure }
