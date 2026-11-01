/**
 * Favorites kept in the user's own VRChat and ChilloutVR accounts (owner,
 * 2026-11-01), beside VRX's own stars. Pure: bundled into both processes.
 *
 * Both community apps work the same way, and VRX copies the stricter of the
 * two wherever they differ:
 *
 *   - VRCX: a favorite goes into one of the account's VRChat favorite groups
 *     (`POST /favorites`, `DELETE /favorites/{id}`). Groups have fixed names
 *     and a cap each. VRCX reads the groups and the favorites once per sign-in.
 *   - CVRX: a favorite is a set of the user's own ChilloutVR categories
 *     (`POST /categories/assign` with the item's whole list). CVRX reads the
 *     categories once per sign-in and never creates one from its picker.
 *
 * VRX reads once per sign-in (a press of Refresh in Explore can read again),
 * sends one write per press, spaces writes on a platform apart, never resends
 * one, never creates or renames a group, and reads a ChilloutVR item's
 * categories right before it writes, so a category set in the game is never
 * dropped.
 */
import type { ExploreWorld } from './explore'
import type { FavoritesRevision } from './favorites'

export type GameFavoriteKind = 'friend' | 'world'

/** Spacing between two favorite writes on the same platform. */
export const GAME_FAVORITE_WRITE_SPACING_MS = 2_000
/** A Refresh press inside this window reuses the last read. */
export const GAME_FAVORITE_REFRESH_COOLDOWN_MS = 60_000
/** After a failed read, VRX waits this long before reading on its own again. */
export const GAME_FAVORITE_FAILURE_BACKOFF_MS = 5 * 60_000
/** Most groups of one kind VRX shows (VRChat has 3 to 4, ChilloutVR is open-ended). */
export const GAME_FAVORITE_GROUPS_MAX = 20
/** Most favorite worlds VRX lists per platform. */
export const GAME_FAVORITE_WORLDS_MAX = 400
/** Most favorite friends VRX keeps per platform. */
export const GAME_FAVORITE_FRIENDS_MAX = 1_000
/** Longest group name VRX shows; longer names are cut. */
export const GAME_FAVORITE_GROUP_NAME_MAX = 64

export interface GameFavoriteGroup {
  /** Opaque to the renderer; it sends the key back to name the group. */
  key: string
  /** The name the user gave it, or the platform's default name. */
  name: string
  /** Most items the group holds (VRChat), or null where the platform sets none. */
  capacity: number | null
  /** Items in it as far as VRX knows. */
  count: number
}

export interface GameFavorites {
  /** VRChat keeps a favorite in one group; ChilloutVR allows several. */
  oneGroupPerItem: boolean
  groups: Record<GameFavoriteKind, GameFavoriteGroup[]>
  /** Friend id → keys of the groups holding them. */
  friends: Record<string, string[]>
  /** World id → keys of the groups holding it. */
  worlds: Record<string, string[]>
  /** The account's favorite worlds as Explore references, in the game's order. */
  worldList: ExploreWorld[]
}

export type GameFavoritesUnavailable =
  /** Settings → Use my game favorites is off. */
  'off' | 'not-authenticated' | 'rate-limited' | 'unavailable'

export type GameFavoritesResult =
  | { state: 'ready'; favorites: GameFavorites; revision: FavoritesRevision }
  | { state: GameFavoritesUnavailable }

export type GameFavoriteWriteFailure =
  | 'off'
  | 'not-authenticated'
  | 'not-friend'
  | 'rate-limited'
  | 'unavailable'
  | 'stale'
  | 'invalid'
  /** The group is at its cap. */
  | 'full'
  /** VRChat: the item already sits in another group. */
  | 'other-group'

export type GameFavoriteWriteResult =
  { ok: true; groups: string[] } | { ok: false; reason: GameFavoriteWriteFailure }

/** The groups an item may be added to right now, by the platform's rules. */
export function canAddToGroup(
  favorites: Pick<GameFavorites, 'oneGroupPerItem'>,
  current: readonly string[],
  group: GameFavoriteGroup
): boolean {
  if (current.includes(group.key)) return false
  if (favorites.oneGroupPerItem && current.length > 0) return false
  return group.capacity === null || group.count < group.capacity
}
