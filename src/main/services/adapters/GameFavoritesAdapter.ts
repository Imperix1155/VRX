import { isCommunityUserId } from '@shared/community'
import {
  GAME_FAVORITE_GROUP_NAME_MAX,
  GAME_FAVORITE_GROUPS_MAX,
  type GameFavoriteKind
} from '@shared/gameFavorites'
import { isHomeWorldId } from '@shared/homeWorld'
import type { Platform } from '@shared/types'
import type { ExploreWorldEvidence } from './ExploreAdapter'
import type { RequestPriority } from './ApiAdmissionController'
import type { RequestLease } from './RequestLease'

/** One group an item sits in. `entryId` is VRChat's favorite record id. */
export interface GameFavoriteMembership {
  key: string
  entryId: string | null
}

export interface GameFavoriteGroupInfo {
  key: string
  name: string
  capacity: number | null
}

/** One sign-in's read of the account's favorites. */
export interface GameFavoritesRead {
  oneGroupPerItem: boolean
  groups: Record<GameFavoriteKind, GameFavoriteGroupInfo[]>
  friends: Map<string, GameFavoriteMembership[]>
  worlds: Map<string, GameFavoriteMembership[]>
  /** Favorite worlds as Explore evidence, in the game's order. */
  worldEvidence: ExploreWorldEvidence[]
}

export interface GameFavoriteChange {
  kind: GameFavoriteKind
  /** The friend's or world's platform id; the service checked its shape. */
  id: string
  group: GameFavoriteGroupInfo
  on: boolean
  /** What VRX knows the item sits in now. */
  current: readonly GameFavoriteMembership[]
  /** Every group of this kind (ChilloutVR keeps only these on a write). */
  groups: readonly GameFavoriteGroupInfo[]
}

/**
 * Main-only access to the favorites in the signed-in user's own account. Kept
 * apart from the read-only adapters because it writes. Every write follows a
 * press, waits in the platform's shared admission line, and is never resent.
 */
export interface GameFavoritesAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureFavoritesLease(): RequestLease
  /** Automatic reads wait behind the user's own presses (`background`). */
  readGameFavorites(lease: RequestLease, priority?: RequestPriority): Promise<GameFavoritesRead>
  /** Send the one write. Returns the item's groups after it. */
  writeGameFavorite(
    change: GameFavoriteChange,
    lease: RequestLease
  ): Promise<GameFavoriteMembership[]>
  /**
   * ChilloutVR only: friend id → categories, live from the roster and VRX's
   * own writes, so a friend list read after the favorites read still counts.
   */
  friendFavoriteGroups?(): ReadonlyMap<string, readonly string[]>
}

/** A reply did not have the shape VRX checks for, so nothing was written. */
export class GameFavoritesDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameFavoritesDataError'
  }
}

/** Shape check for an item id, so nothing else can reach a request path. */
export function isGameFavoriteId(
  platform: Platform,
  kind: GameFavoriteKind,
  value: unknown
): value is string {
  return kind === 'friend' ? isCommunityUserId(platform, value) : isHomeWorldId(platform, value)
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function groupName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length === 0) return null
  return name.length > GAME_FAVORITE_GROUP_NAME_MAX
    ? `${name.slice(0, GAME_FAVORITE_GROUP_NAME_MAX - 1)}…`
    : name
}

function count(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback
}

// ── VRChat ─────────────────────────────────────────────────────────────────

/** VRChat group types VRX writes to. A VRC+ world group is offered only when
 *  the account already has it (VRCX offers them to everyone). */
export type VrcFavoriteType = 'friend' | 'world' | 'vrcPlusWorld'

const VRC_GROUP_NAME = /^[A-Za-z0-9_]{1,32}$/
const VRC_FAVORITE_ENTRY_ID = /^fvrt_[0-9a-f-]{36}$/i

export interface VrcFavoriteLimits {
  friend: { groups: number; perGroup: number }
  world: { groups: number; perGroup: number }
  vrcPlusWorld: { perGroup: number }
}

/** VRCX's defaults, used when the limits reply is missing a value. */
export const VRC_DEFAULT_FAVORITE_LIMITS: VrcFavoriteLimits = {
  friend: { groups: 3, perGroup: 150 },
  world: { groups: 4, perGroup: 100 },
  vrcPlusWorld: { perGroup: 100 }
}

export function parseVrcFavoriteLimits(value: unknown): VrcFavoriteLimits {
  const raw = record(value)
  const groups = record(raw?.maxFavoriteGroups)
  const perGroup = record(raw?.maxFavoritesPerGroup)
  const d = VRC_DEFAULT_FAVORITE_LIMITS
  return {
    friend: {
      groups: count(groups?.friend, d.friend.groups, GAME_FAVORITE_GROUPS_MAX),
      perGroup: count(perGroup?.friend, d.friend.perGroup, 1_000)
    },
    world: {
      groups: count(groups?.world, d.world.groups, GAME_FAVORITE_GROUPS_MAX),
      perGroup: count(perGroup?.world, d.world.perGroup, 1_000)
    },
    vrcPlusWorld: { perGroup: count(perGroup?.vrcPlusWorld, d.vrcPlusWorld.perGroup, 1_000) }
  }
}

export interface VrcServerGroup {
  type: VrcFavoriteType
  name: string
  displayName: string | null
}

export function parseVrcFavoriteGroups(value: unknown): VrcServerGroup[] {
  if (!Array.isArray(value))
    throw new GameFavoritesDataError('VRChat favorite groups were malformed')
  const groups: VrcServerGroup[] = []
  for (const entry of value) {
    const raw = record(entry)
    if (!raw) continue
    const type = raw.type
    if (type !== 'friend' && type !== 'world' && type !== 'vrcPlusWorld') continue
    if (typeof raw.name !== 'string' || !VRC_GROUP_NAME.test(raw.name)) continue
    groups.push({ type, name: raw.name, displayName: groupName(raw.displayName) })
  }
  return groups
}

export function vrcGroupKey(type: VrcFavoriteType, name: string): string {
  return `${type}:${name}`
}

/** The type and name behind a key VRX built, or null for anything else. */
export function parseVrcGroupKey(key: string): { type: VrcFavoriteType; name: string } | null {
  const at = key.indexOf(':')
  if (at < 0) return null
  const type = key.slice(0, at)
  const name = key.slice(at + 1)
  if (type !== 'friend' && type !== 'world' && type !== 'vrcPlusWorld') return null
  return VRC_GROUP_NAME.test(name) ? { type, name } : null
}

/**
 * The groups VRCX shows: `group_0…` for friends and `worlds1…` for worlds, as
 * many as the limits allow, with the names the user gave them. A server group
 * whose name is not a default takes a free slot, as in VRCX.
 */
export function buildVrcGroups(
  limits: VrcFavoriteLimits,
  server: readonly VrcServerGroup[]
): Record<GameFavoriteKind, GameFavoriteGroupInfo[]> {
  const slots = (
    type: 'friend' | 'world',
    total: number,
    capacity: number,
    defaultName: (i: number) => string
  ): GameFavoriteGroupInfo[] => {
    const own = server.filter((group) => group.type === type)
    const names = Array.from({ length: total }, (_, i) => defaultName(i))
    const extras = own.filter((group) => !names.includes(group.name))
    return names.map((name, i) => {
      const group = own.find((g) => g.name === name) ?? extras.shift()
      return {
        key: vrcGroupKey(type, group?.name ?? name),
        name: group?.displayName ?? `Group ${i + 1}`,
        capacity
      }
    })
  }
  const friend = slots('friend', limits.friend.groups, limits.friend.perGroup, (i) => `group_${i}`)
  const world = slots('world', limits.world.groups, limits.world.perGroup, (i) => `worlds${i + 1}`)
  for (const group of server) {
    if (group.type !== 'vrcPlusWorld' || world.length >= GAME_FAVORITE_GROUPS_MAX) continue
    world.push({
      key: vrcGroupKey('vrcPlusWorld', group.name),
      name: group.displayName ?? group.name,
      capacity: limits.vrcPlusWorld.perGroup
    })
  }
  return { friend, world }
}

/** One `GET /favorites?type=friend` page: user id → group and record id. */
export function parseVrcFriendFavoritePage(
  value: unknown
): Array<{ userId: string; groupName: string; entryId: string | null }> {
  if (!Array.isArray(value)) throw new GameFavoritesDataError('VRChat favorites were malformed')
  const entries: Array<{ userId: string; groupName: string; entryId: string | null }> = []
  for (const entry of value) {
    const raw = record(entry)
    if (!raw || raw.type !== 'friend' || !isCommunityUserId('vrchat', raw.favoriteId)) continue
    const tag = Array.isArray(raw.tags) ? raw.tags.find((t) => typeof t === 'string') : undefined
    if (typeof tag !== 'string' || !VRC_GROUP_NAME.test(tag)) continue
    const entryId = typeof raw.id === 'string' && VRC_FAVORITE_ENTRY_ID.test(raw.id) ? raw.id : null
    entries.push({ userId: raw.favoriteId, groupName: tag, entryId })
  }
  return entries
}

/** One `GET /worlds/favorites` page: world id → group and record id. */
export function parseVrcWorldFavoritePage(
  value: unknown
): Array<{ worldId: string; groupName: string; entryId: string | null }> {
  if (!Array.isArray(value))
    throw new GameFavoritesDataError('VRChat favorite worlds were malformed')
  const entries: Array<{ worldId: string; groupName: string; entryId: string | null }> = []
  for (const entry of value) {
    const raw = record(entry)
    if (!raw || !isHomeWorldId('vrchat', raw.id)) continue
    if (typeof raw.favoriteGroup !== 'string' || !VRC_GROUP_NAME.test(raw.favoriteGroup)) continue
    const entryId =
      typeof raw.favoriteId === 'string' && VRC_FAVORITE_ENTRY_ID.test(raw.favoriteId)
        ? raw.favoriteId
        : null
    entries.push({ worldId: raw.id, groupName: raw.favoriteGroup, entryId })
  }
  return entries
}

/** The record id from a `POST /favorites` reply, or null when it did not say. */
export function parseVrcAddedFavorite(value: unknown, objectId: string): string | null {
  const raw = record(value)
  if (!raw || raw.favoriteId !== objectId) return null
  return typeof raw.id === 'string' && VRC_FAVORITE_ENTRY_ID.test(raw.id) ? raw.id : null
}

// ── ChilloutVR ─────────────────────────────────────────────────────────────

/** ChilloutVR's built-in categories (CVRX's two lists), never written. */
const CVR_SYSTEM_CATEGORIES = new Set([
  'frndonline',
  'frndoffline',
  'friends_online',
  'friends_offline',
  'wrldactive',
  'wrldnew',
  'wrldtrending',
  'wrldofficial',
  'wrldavatars',
  'wrldpublic',
  'wrldrecentlyupdated',
  'wrldmine'
])

const CVR_USER_CATEGORY: Record<GameFavoriteKind, RegExp> = {
  friend: /^friends_[A-Za-z0-9_-]{1,96}$/,
  world: /^worlds_[A-Za-z0-9_-]{1,96}$/
}

/** Whether a category id is one the user made (CVRX's prefix rule plus its system lists). */
export function isCvrUserCategory(kind: GameFavoriteKind, id: unknown): id is string {
  return (
    typeof id === 'string' && CVR_USER_CATEGORY[kind].test(id) && !CVR_SYSTEM_CATEGORIES.has(id)
  )
}

/** `GET /categories`: the user's own friend and world categories. */
export function parseCvrCategories(
  value: unknown
): Record<GameFavoriteKind, GameFavoriteGroupInfo[]> {
  const raw = record(value)
  if (!raw) throw new GameFavoritesDataError('ChilloutVR categories were malformed')
  const read = (kind: GameFavoriteKind, list: unknown): GameFavoriteGroupInfo[] => {
    if (!Array.isArray(list)) return []
    const groups: GameFavoriteGroupInfo[] = []
    for (const entry of list) {
      const item = record(entry)
      if (!item || !isCvrUserCategory(kind, item.id)) continue
      if (groups.some((group) => group.key === item.id)) continue
      groups.push({ key: item.id, name: groupName(item.name) ?? item.id, capacity: null })
      if (groups.length >= GAME_FAVORITE_GROUPS_MAX) break
    }
    return groups
  }
  return { friend: read('friend', raw.friends), world: read('world', raw.worlds) }
}

/**
 * The categories on one person or world, from `GET /users/{id}` or
 * `GET /worlds/{id}`, or null when the reply did not say (VRX then refuses to
 * write, since it cannot tell what the write would replace).
 */
export function parseCvrItemCategories(value: unknown, expectedId: string): string[] | null {
  const raw = record(value)
  if (!raw || typeof raw.id !== 'string' || raw.id.toLowerCase() !== expectedId.toLowerCase()) {
    return null
  }
  if (!Array.isArray(raw.categories)) return null
  return raw.categories.filter((id): id is string => typeof id === 'string')
}
