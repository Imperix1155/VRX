import type { Platform } from '@shared/types'
import {
  FAVORITE_FRIENDS_MAX,
  FAVORITE_WORLD_NAME_MAX,
  FAVORITE_WORLDS_MAX,
  type FavoriteWriteResult,
  type FavoritesRevision
} from '@shared/favorites'
import type { AccountSession } from './accountSession'
import type { FavoriteWorldRecord, FavoriteWorldsData, SocialStore } from './socialStore'

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_ID_LENGTH = 128
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

type WriteFailure = Extract<FavoriteWriteResult, { ok: false }>['reason']

/** A stored favorite world, newest first when listed. */
export interface FavoriteWorld extends FavoriteWorldRecord {
  worldId: string
}

/** What main knows about a world when it is starred (its own Explore record). */
export interface FavoriteWorldEvidence {
  worldId: string
  name: string
  thumbnailUrl: string | null
}

interface Cached<T> {
  accountKey: string
  epoch: number
  value: T
}

export function isValidFavoriteId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    !FORBIDDEN_KEYS.has(id) &&
    ID_PATTERN.test(id)
  )
}

function sameRevision(
  revision: FavoritesRevision | undefined,
  current: FavoritesRevision
): boolean {
  return (
    revision?.platformAccountId === current.platformAccountId && revision.epoch === current.epoch
  )
}

function failureOf(error: unknown): 'stale' | 'invalid' {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('stale account epoch') ? 'stale' : 'invalid'
}

/**
 * Favorite friends and worlds for each signed-in account (owner, 2026-11-01).
 * Stored only in this computer's SocialStore (`favorites` for friends,
 * `favoriteWorlds` for worlds); nothing is sent to a platform. A world keeps
 * the name and picture address VRX already had when it was starred, so the
 * Favorites list shows without asking the platform for anything.
 */
export class Favorites {
  private readonly friendCache = new Map<Platform, Cached<ReadonlySet<string>>>()
  private readonly worldCache = new Map<Platform, Cached<FavoriteWorldsData>>()

  constructor(
    private readonly accountSession: AccountSession,
    private readonly socialStore: SocialStore,
    private readonly clock: () => number = () => Date.now()
  ) {}

  /** The current account's favorite friends, or none with no revision while signed out. */
  listFriends(platform: Platform): { friendIds: string[]; revision?: FavoritesRevision } {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return { friendIds: [] }
    return { friendIds: [...this.friendIdsFor(platform, revision)], revision }
  }

  /** Star or unstar one or more friends in one write. */
  setFriends(
    platform: Platform,
    friendIds: unknown,
    favorite: unknown,
    revision: FavoritesRevision | undefined
  ): FavoriteWriteResult {
    const current = this.revisionFor(platform)
    if (current === undefined) return { ok: false, reason: 'not-authenticated' }
    if (
      !Array.isArray(friendIds) ||
      friendIds.length === 0 ||
      friendIds.length > FAVORITE_FRIENDS_MAX ||
      !friendIds.every(isValidFavoriteId) ||
      typeof favorite !== 'boolean'
    ) {
      return { ok: false, reason: 'invalid' }
    }
    if (!sameRevision(revision, current)) return { ok: false, reason: 'stale' }

    const before = this.friendIdsFor(platform, current)
    const ids = new Set(before)
    for (const id of friendIds) {
      if (favorite) ids.add(id)
      else ids.delete(id)
    }
    if (ids.size === before.size && [...ids].every((id) => before.has(id))) return { ok: true }
    if (ids.size > FAVORITE_FRIENDS_MAX) return { ok: false, reason: 'full' }

    const data: Record<string, true> = {}
    for (const id of ids) data[id] = true
    const failure = this.write(() =>
      this.socialStore.write(this.context(platform, current), 'favorites', data)
    )
    if (failure !== null) return { ok: false, reason: failure }
    this.friendCache.set(platform, this.cached(platform, current, ids))
    return { ok: true }
  }

  /** The current account's favorite worlds, newest first. */
  listWorlds(platform: Platform): { worlds: FavoriteWorld[]; revision?: FavoritesRevision } {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return { worlds: [] }
    const worlds = Object.entries(this.worldsFor(platform, revision))
      .map(([worldId, record]) => ({ worldId, ...record }))
      .sort((a, b) => b.addedAt - a.addedAt || a.worldId.localeCompare(b.worldId))
    return { worlds, revision }
  }

  /** Star a world from what main already knows about it. */
  addWorld(
    platform: Platform,
    evidence: FavoriteWorldEvidence,
    revision: FavoritesRevision | undefined
  ): FavoriteWriteResult {
    const current = this.revisionFor(platform)
    if (current === undefined) return { ok: false, reason: 'not-authenticated' }
    if (!isValidFavoriteId(evidence.worldId)) return { ok: false, reason: 'invalid' }
    if (!sameRevision(revision, current)) return { ok: false, reason: 'stale' }

    const before = this.worldsFor(platform, current)
    if (Object.hasOwn(before, evidence.worldId)) return { ok: true }
    if (Object.keys(before).length >= FAVORITE_WORLDS_MAX) return { ok: false, reason: 'full' }
    const thumbnailUrl =
      evidence.thumbnailUrl !== null && evidence.thumbnailUrl.length <= 2_048
        ? evidence.thumbnailUrl
        : null
    const next: FavoriteWorldsData = {
      ...before,
      [evidence.worldId]: {
        name: evidence.name.slice(0, FAVORITE_WORLD_NAME_MAX),
        thumbnailUrl,
        addedAt: Math.max(0, Math.floor(this.clock()))
      }
    }
    return this.saveWorlds(platform, current, next)
  }

  /** Unstar a world by its id. Unstarring one that is not starred is fine. */
  removeWorld(
    platform: Platform,
    worldId: unknown,
    revision: FavoritesRevision | undefined
  ): FavoriteWriteResult {
    const current = this.revisionFor(platform)
    if (current === undefined) return { ok: false, reason: 'not-authenticated' }
    if (!isValidFavoriteId(worldId)) return { ok: false, reason: 'invalid' }
    if (!sameRevision(revision, current)) return { ok: false, reason: 'stale' }

    const before = this.worldsFor(platform, current)
    if (!Object.hasOwn(before, worldId)) return { ok: true }
    const next: FavoriteWorldsData = { ...before }
    delete next[worldId]
    return this.saveWorlds(platform, current, next)
  }

  private saveWorlds(
    platform: Platform,
    current: FavoritesRevision,
    next: FavoriteWorldsData
  ): FavoriteWriteResult {
    const failure = this.write(() =>
      this.socialStore.write(this.context(platform, current), 'favoriteWorlds', next)
    )
    if (failure !== null) return { ok: false, reason: failure }
    this.worldCache.set(platform, this.cached(platform, current, next))
    return { ok: true }
  }

  private write(run: () => unknown): WriteFailure | null {
    try {
      run()
      return null
    } catch (error) {
      return failureOf(error)
    }
  }

  private context(
    platform: Platform,
    current: FavoritesRevision
  ): { platform: Platform; platformAccountId: string; epoch: number } {
    return { platform, platformAccountId: current.platformAccountId, epoch: current.epoch }
  }

  private cached<T>(platform: Platform, revision: FavoritesRevision, value: T): Cached<T> {
    return { accountKey: `${platform}:${revision.platformAccountId}`, epoch: revision.epoch, value }
  }

  private revisionFor(platform: Platform): FavoritesRevision | undefined {
    const resolution = this.accountSession.resolve(platform)
    if ('status' in resolution) return undefined
    const platformAccountId = this.accountSession.getAccountId(platform)
    if (platformAccountId === null) return undefined
    return { platformAccountId, epoch: resolution.epoch }
  }

  private friendIdsFor(platform: Platform, revision: FavoritesRevision): ReadonlySet<string> {
    const hit = this.friendCache.get(platform)
    if (hit && hit.accountKey === `${platform}:${revision.platformAccountId}`) {
      if (hit.epoch === revision.epoch) return hit.value
    }
    const stored = this.socialStore.read(platform, revision.platformAccountId, 'favorites')
    const ids = new Set(Object.keys(stored?.data ?? {}).filter(isValidFavoriteId))
    this.friendCache.set(platform, this.cached(platform, revision, ids))
    return ids
  }

  private worldsFor(platform: Platform, revision: FavoritesRevision): FavoriteWorldsData {
    const hit = this.worldCache.get(platform)
    if (hit && hit.accountKey === `${platform}:${revision.platformAccountId}`) {
      if (hit.epoch === revision.epoch) return hit.value
    }
    const stored = this.socialStore.read(platform, revision.platformAccountId, 'favoriteWorlds')
    const worlds: FavoriteWorldsData = {}
    for (const [worldId, record] of Object.entries(stored?.data ?? {})) {
      if (isValidFavoriteId(worldId)) worlds[worldId] = record
    }
    this.worldCache.set(platform, this.cached(platform, revision, worlds))
    return worlds
  }
}
