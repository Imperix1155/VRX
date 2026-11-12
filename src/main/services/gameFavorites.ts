import type { FavoritesRevision } from '@shared/favorites'
import {
  GAME_FAVORITE_FAILURE_BACKOFF_MS,
  GAME_FAVORITE_REFRESH_COOLDOWN_MS,
  GAME_FAVORITE_WORLDS_MAX,
  GAME_FAVORITE_WRITE_SPACING_MS,
  canAddToGroup,
  type GameFavoriteGroup,
  type GameFavoriteKind,
  type GameFavoritesUnavailable,
  type GameFavoriteWriteFailure,
  type GameFavoriteWriteResult
} from '@shared/gameFavorites'
import type { Platform } from '@shared/types'
import type { ExploreWorldEvidence } from './adapters/ExploreAdapter'
import {
  GameFavoritesDataError,
  isGameFavoriteId,
  type GameFavoriteMembership,
  type GameFavoritesAdapter,
  type GameFavoritesRead
} from './adapters/GameFavoritesAdapter'
import { CommunityDataError } from './adapters/CommunityAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import type { AccountSession } from './accountSession'

type GameFavoritesLog = (
  message: 'game favorites request failed',
  meta: { platform: Platform; kind: 'read' | 'write'; reason: string }
) => void

export interface GameFavoritesServiceOptions {
  adapters: ReadonlyMap<Platform, GameFavoritesAdapter>
  accountSession: Pick<AccountSession, 'resolve' | 'getAccountId'>
  /** Whether the person is on the signed-in user's friends list now. */
  isFriend: (platform: Platform, userId: string) => boolean
  /** Settings → Use my game favorites. */
  isEnabled: () => boolean
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: GameFavoritesLog
}

/** What one platform's favorites look like now, for the IPC layer to publish. */
export interface GameFavoritesView {
  oneGroupPerItem: boolean
  groups: Record<GameFavoriteKind, GameFavoriteGroup[]>
  friends: Record<string, string[]>
  worlds: Record<string, string[]>
  worldEvidence: ExploreWorldEvidence[]
}

export type GameFavoritesGet =
  | { state: 'ready'; view: GameFavoritesView; revision: FavoritesRevision }
  | { state: GameFavoritesUnavailable }

export interface GameFavoriteWriteRequest {
  platform: Platform
  kind: GameFavoriteKind
  id: string
  groupKey: string
  on: boolean
  revision: FavoritesRevision
  /** For a world being added: main's own record of it, so Explore can list it. */
  world?: ExploreWorldEvidence
}

interface Loaded {
  accountId: string
  generation: number
  read: GameFavoritesRead
  loadedAt: number
}

/** What one press comes to: an answer with nothing to send, or the write to send. */
type PlannedWrite =
  | { result: GameFavoriteWriteResult }
  | { loaded: Loaded; send: () => Promise<GameFavoriteMembership[]> }

interface Failed {
  accountId: string
  generation: number
  at: number
  reason: Exclude<GameFavoritesUnavailable, 'off'>
}

/**
 * The favorites in the user's own VRChat and ChilloutVR accounts. Nothing runs
 * on a timer: the first ask after a sign-in reads once, a Refresh press can
 * read again after GAME_FAVORITE_REFRESH_COOLDOWN_MS, and each write follows
 * a press. Writes on a platform go one at a time,
 * GAME_FAVORITE_WRITE_SPACING_MS apart, and none is sent twice on its own.
 */
export class GameFavoritesService {
  private readonly clock: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: GameFavoritesLog
  private readonly loaded = new Map<Platform, Loaded>()
  private readonly failed = new Map<Platform, Failed>()
  private readonly loading = new Map<
    Platform,
    { generation: number; promise: Promise<GameFavoritesGet> }
  >()
  private readonly writes = new Map<Platform, Promise<unknown>>()
  private readonly lastWriteAt = new Map<Platform, number>()

  constructor(private readonly options: GameFavoritesServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.log = options.log ?? (() => undefined)
  }

  async get(platform: Platform, refresh = false): Promise<GameFavoritesGet> {
    if (!this.options.isEnabled()) return { state: 'off' }
    const revision = this.revision(platform)
    const adapter = this.options.adapters.get(platform)
    if (revision === null || !adapter) return { state: 'not-authenticated' }
    let lease: RequestLease
    try {
      lease = adapter.captureFavoritesLease()
    } catch {
      return { state: 'not-authenticated' }
    }
    const now = this.clock()
    const loaded = this.loaded.get(platform)
    const current =
      loaded?.generation === lease.generation && loaded.accountId === revision.platformAccountId
        ? loaded
        : undefined
    const failed = this.failed.get(platform)
    const failedHere =
      failed !== undefined &&
      failed.generation === lease.generation &&
      failed.accountId === revision.platformAccountId
    if (current) {
      // A Refresh reads again only once the cooldown has passed since the
      // last read, and since the last failed one, so repeated presses after
      // a failure never start a new read each time.
      const cooling =
        now - current.loadedAt < GAME_FAVORITE_REFRESH_COOLDOWN_MS ||
        (failedHere && now - failed.at < GAME_FAVORITE_REFRESH_COOLDOWN_MS)
      if (!refresh || cooling) return this.ready(adapter, current, revision)
    } else if (
      failedHere &&
      now - failed.at <
        (refresh ? GAME_FAVORITE_REFRESH_COOLDOWN_MS : GAME_FAVORITE_FAILURE_BACKOFF_MS)
    ) {
      return { state: failed.reason }
    }
    const running = this.loading.get(platform)
    if (running?.generation === lease.generation) return running.promise
    const promise = this.load(adapter, lease, revision, refresh)
    this.loading.set(platform, { generation: lease.generation, promise })
    try {
      return await promise
    } finally {
      if (this.loading.get(platform)?.promise === promise) this.loading.delete(platform)
    }
  }

  /**
   * The favorites already loaded for the signed-in account, or null. Never
   * starts a read, so it is safe where nothing may be asked of a platform.
   */
  peek(platform: Platform): GameFavoritesView | null {
    if (!this.options.isEnabled()) return null
    const revision = this.revision(platform)
    const adapter = this.options.adapters.get(platform)
    const loaded = this.loaded.get(platform)
    if (revision === null || !adapter || !loaded) return null
    if (loaded.accountId !== revision.platformAccountId) return null
    try {
      if (adapter.captureFavoritesLease().generation !== loaded.generation) return null
    } catch {
      return null
    }
    return this.view(adapter, loaded.read)
  }

  async set(request: GameFavoriteWriteRequest): Promise<GameFavoriteWriteResult> {
    const { platform, kind, id, groupKey, on } = request
    if (!this.options.isEnabled()) return { ok: false, reason: 'off' }
    const revision = this.revision(platform)
    if (
      revision === null ||
      revision.platformAccountId !== request.revision.platformAccountId ||
      revision.epoch !== request.revision.epoch
    ) {
      return { ok: false, reason: 'stale' }
    }
    if (!isGameFavoriteId(platform, kind, id)) return { ok: false, reason: 'invalid' }
    // ChilloutVR friend ids are kept lower-case, as in the roster.
    const itemId = platform === 'chilloutvr' && kind === 'friend' ? id.toLowerCase() : id
    if (kind === 'friend' && !this.options.isFriend(platform, itemId)) {
      return { ok: false, reason: 'not-friend' }
    }
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return { ok: false, reason: 'not-authenticated' }
    let lease: RequestLease
    try {
      lease = adapter.captureFavoritesLease()
    } catch {
      return { ok: false, reason: 'not-authenticated' }
    }
    // Decided from what VRX holds at that moment. It runs once now, for an
    // instant answer, and again when this press reaches the front of the write
    // queue: an earlier press for the same item may have changed its groups
    // meanwhile, and a write planned from the older view would repeat or undo it.
    const plan = (): PlannedWrite => {
      const loaded = this.loaded.get(platform)
      if (
        !loaded ||
        loaded.generation !== lease.generation ||
        loaded.accountId !== revision.platformAccountId
      ) {
        return { result: { ok: false, reason: 'stale' } }
      }
      const view = this.view(adapter, loaded.read)
      const group = view.groups[kind].find((g) => g.key === groupKey)
      if (!group) return { result: { ok: false, reason: 'invalid' } }
      const current = this.memberships(adapter, loaded.read, kind, itemId)
      const keys = current.map((m) => m.key)
      if (on === keys.includes(groupKey)) return { result: { ok: true, groups: keys } }
      if (on && !canAddToGroup(view, keys, group)) {
        return {
          result: {
            ok: false,
            reason: view.oneGroupPerItem && keys.length > 0 ? 'other-group' : 'full'
          }
        }
      }
      return {
        loaded,
        send: () =>
          adapter.writeGameFavorite(
            { kind, id: itemId, group, on, current, groups: loaded.read.groups[kind] },
            lease
          )
      }
    }
    const instant = plan()
    if ('result' in instant) return instant.result

    return this.write(adapter, lease, plan, (loaded, written) => {
      if (this.loaded.get(platform) !== loaded) return { ok: false, reason: 'stale' }
      this.store(loaded.read, kind, itemId, written, on ? request.world : undefined)
      return { ok: true, groups: written.map((m) => m.key) }
    })
  }

  /** Forget a platform's favorites at a sign-out or account change. */
  clearPlatform(platform: Platform): void {
    this.loaded.delete(platform)
    this.failed.delete(platform)
    this.loading.delete(platform)
  }

  private async load(
    adapter: GameFavoritesAdapter,
    lease: RequestLease,
    revision: FavoritesRevision,
    pressed: boolean
  ): Promise<GameFavoritesGet> {
    const platform = adapter.platform
    try {
      // The first read runs ahead of background name lookups: a star's panel
      // cannot offer the account's groups until it lands.
      const read = await adapter.readGameFavorites(lease, pressed ? 'interactive' : 'default')
      if (!lease.isCurrent()) return { state: 'not-authenticated' }
      const loaded: Loaded = {
        accountId: revision.platformAccountId,
        generation: lease.generation,
        read,
        loadedAt: this.clock()
      }
      this.loaded.set(platform, loaded)
      this.failed.delete(platform)
      return this.ready(adapter, loaded, revision)
    } catch (error) {
      const reason = this.readReason(error)
      this.log('game favorites request failed', { platform, kind: 'read', reason })
      if (reason !== 'not-authenticated') {
        this.failed.set(platform, {
          accountId: revision.platformAccountId,
          generation: lease.generation,
          at: this.clock(),
          reason
        })
      }
      // A failed Refresh keeps the favorites VRX already has.
      const loaded = this.loaded.get(platform)
      if (loaded?.generation === lease.generation && reason !== 'not-authenticated') {
        return this.ready(adapter, loaded, revision)
      }
      return { state: reason }
    }
  }

  private ready(
    adapter: GameFavoritesAdapter,
    loaded: Loaded,
    revision: FavoritesRevision
  ): GameFavoritesGet {
    return { state: 'ready', view: this.view(adapter, loaded.read), revision }
  }

  private view(adapter: GameFavoritesAdapter, read: GameFavoritesRead): GameFavoritesView {
    const friends = this.friendMap(adapter, read)
    const counts = new Map<string, number>()
    const tally = (map: ReadonlyMap<string, readonly GameFavoriteMembership[]>): void => {
      for (const memberships of map.values()) {
        for (const m of memberships) counts.set(m.key, (counts.get(m.key) ?? 0) + 1)
      }
    }
    tally(friends)
    tally(read.worlds)
    const groups = (kind: GameFavoriteKind): GameFavoriteGroup[] =>
      read.groups[kind].map((g) => ({ ...g, count: counts.get(g.key) ?? 0 }))
    const record = (
      map: ReadonlyMap<string, readonly GameFavoriteMembership[]>
    ): Record<string, string[]> => {
      const out = Object.create(null) as Record<string, string[]>
      for (const [id, memberships] of map) {
        if (memberships.length > 0) out[id] = memberships.map((m) => m.key)
      }
      return out
    }
    return {
      oneGroupPerItem: read.oneGroupPerItem,
      groups: { friend: groups('friend'), world: groups('world') },
      friends: record(friends),
      worlds: record(read.worlds),
      worldEvidence: read.worldEvidence.filter((w) => (read.worlds.get(w.worldId)?.length ?? 0) > 0)
    }
  }

  /** ChilloutVR friends come live from the roster; VRChat's from the read. */
  private friendMap(
    adapter: GameFavoritesAdapter,
    read: GameFavoritesRead
  ): ReadonlyMap<string, readonly GameFavoriteMembership[]> {
    const live = adapter.friendFavoriteGroups?.()
    if (!live) return read.friends
    const keys = new Set(read.groups.friend.map((g) => g.key))
    const map = new Map<string, GameFavoriteMembership[]>()
    for (const [id, categories] of live) {
      const memberships = categories
        .filter((key) => keys.has(key))
        .map((key) => ({ key, entryId: null }))
      if (memberships.length > 0) map.set(id, memberships)
    }
    return map
  }

  private memberships(
    adapter: GameFavoritesAdapter,
    read: GameFavoritesRead,
    kind: GameFavoriteKind,
    id: string
  ): GameFavoriteMembership[] {
    const map = kind === 'friend' ? this.friendMap(adapter, read) : read.worlds
    return [...(map.get(id) ?? [])]
  }

  private store(
    read: GameFavoritesRead,
    kind: GameFavoriteKind,
    id: string,
    memberships: GameFavoriteMembership[],
    world: ExploreWorldEvidence | undefined
  ): void {
    const map = kind === 'friend' ? read.friends : read.worlds
    if (memberships.length > 0) map.set(id, memberships)
    else map.delete(id)
    if (kind !== 'world') return
    const listed = read.worldEvidence.some((w) => w.worldId === id)
    if (memberships.length > 0 && !listed && world?.worldId === id) {
      // Newest first in VRX's list, as with its own stars.
      read.worldEvidence.unshift({ ...world })
      read.worldEvidence.splice(GAME_FAVORITE_WORLDS_MAX)
    }
  }

  /**
   * One write at a time per platform, GAME_FAVORITE_WRITE_SPACING_MS apart.
   * `plan` runs again once the earlier writes have finished; a press they made
   * moot is answered there, with nothing sent and no spacing spent. `commit`
   * records the answer before the next queued press plans from it.
   */
  private async write(
    adapter: GameFavoritesAdapter,
    lease: RequestLease,
    plan: () => PlannedWrite,
    commit: (loaded: Loaded, written: GameFavoriteMembership[]) => GameFavoriteWriteResult
  ): Promise<GameFavoriteWriteResult> {
    const platform = adapter.platform
    const previous = this.writes.get(platform) ?? Promise.resolve()
    const run = previous.then(async (): Promise<GameFavoriteWriteResult> => {
      const planned = plan()
      if ('result' in planned) return planned.result
      const last = this.lastWriteAt.get(platform)
      const wait = last === undefined ? 0 : last + GAME_FAVORITE_WRITE_SPACING_MS - this.clock()
      if (wait > 0) await this.sleep(wait)
      if (!lease.isCurrent() || lease.signal.aborted) throw new RequestCancelledError()
      // The user may have turned game favorites off while this write waited.
      if (!this.options.isEnabled()) return { ok: false, reason: 'off' }
      try {
        return commit(planned.loaded, await planned.send())
      } finally {
        this.lastWriteAt.set(platform, this.clock())
      }
    })
    this.writes.set(
      platform,
      run.catch(() => undefined)
    )
    try {
      return await run
    } catch (error) {
      const reason = this.writeReason(error)
      this.log('game favorites request failed', { platform, kind: 'write', reason })
      return { ok: false, reason }
    }
  }

  private revision(platform: Platform): FavoritesRevision | null {
    const resolution = this.options.accountSession.resolve(platform)
    if ('status' in resolution) return null
    const platformAccountId = this.options.accountSession.getAccountId(platform)
    if (platformAccountId === null) return null
    return { platformAccountId, epoch: resolution.epoch }
  }

  private readReason(error: unknown): Exclude<GameFavoritesUnavailable, 'off'> {
    if (error instanceof AuthError || error instanceof RequestCancelledError) {
      return 'not-authenticated'
    }
    if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
      return 'rate-limited'
    }
    return 'unavailable'
  }

  private writeReason(error: unknown): GameFavoriteWriteFailure {
    if (error instanceof RequestCancelledError) return 'stale'
    if (error instanceof AuthError) return 'not-authenticated'
    if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
      return 'rate-limited'
    }
    if (error instanceof GameFavoritesDataError || error instanceof CommunityDataError) {
      return 'invalid'
    }
    return 'unavailable'
  }
}
