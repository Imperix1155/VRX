/**
 * Favorite friends and worlds (owner, 2026-11-01). Stars live only in VRX,
 * per signed-in account; nothing is sent to VRChat or ChilloutVR.
 */

/** Most favorite friends one account can keep (the SocialStore cap). */
export const FAVORITE_FRIENDS_MAX = 5_000
/** Most favorite worlds one account can keep. */
export const FAVORITE_WORLDS_MAX = 100
/** Longest stored world name; longer names are cut, never refused. */
export const FAVORITE_WORLD_NAME_MAX = 256

export interface FavoritesRevision {
  platformAccountId: string
  epoch: number
}

export type FavoriteWriteResult =
  | { ok: true }
  | { ok: false; reason: 'not-authenticated' | 'invalid' | 'stale' | 'full' | 'rate-limited' }
