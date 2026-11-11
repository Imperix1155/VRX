/**
 * The signed-in user's own rating of a VRChat world. The platform returns
 * `like`, `dislike` or `null` (not rated). There is no public like count, and
 * a dislike is private to that user, so nothing here ranks worlds.
 *
 * The renderer names the world by the Explore reference main issued.
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */

/** How long a successful read may be reused, in main and in the world sheet. */
export const WORLD_RATING_CACHE_MS = 5 * 60 * 1000

/** Spacing between two rating changes on VRChat. One change runs at a time. */
export const WORLD_RATING_WRITE_SPACING_MS = 1_000

export const WORLD_RATINGS = ['like', 'dislike'] as const
export type WorldRatingValue = (typeof WORLD_RATINGS)[number]

/** `null` means the signed-in user has not rated the world. */
export type WorldRating = WorldRatingValue | null

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const VRC_WORLD_ID = new RegExp(`^wrld_${GUID}$`, 'i')

export function isWorldRatingValue(value: unknown): value is WorldRatingValue {
  return value === 'like' || value === 'dislike'
}

/** Shape check only, so nothing else can reach the rating path. */
export function isVrchatWorldId(value: unknown): value is string {
  return typeof value === 'string' && VRC_WORLD_ID.test(value)
}

export type WorldRatingFailure =
  'not-authenticated' | 'not-vrchat' | 'unknown-world' | 'rate-limited' | 'failed' | 'stale'

export type SetWorldRatingFailure = WorldRatingFailure | 'cooldown'

export type WorldRatingRead =
  { ok: true; value: WorldRating } | { ok: false; reason: WorldRatingFailure }

export type SetWorldRatingResult =
  { ok: true; value: WorldRating } | { ok: false; reason: SetWorldRatingFailure }
