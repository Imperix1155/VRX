import {
  WORLD_RATING_CACHE_MS,
  WORLD_RATING_WRITE_SPACING_MS,
  isVrchatWorldId,
  type SetWorldRatingFailure,
  type SetWorldRatingResult,
  type WorldRating,
  type WorldRatingFailure,
  type WorldRatingRead
} from '@shared/worldRating'
import type { Platform } from '@shared/types'
import type { WorldRatingAdapter } from './adapters/WorldRatingAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type WorldRatingLog = (
  message: 'world rating denied',
  meta: { platform: Platform; reason: WorldRatingFailure | SetWorldRatingFailure }
) => void

export interface WorldRatingServiceOptions {
  adapters: ReadonlyMap<Platform, WorldRatingAdapter>
  /** The world ID behind an Explore reference main issued (`ExploreService.worldIdFor`). */
  resolveWorld: (platform: Platform, worldRef: string) => string | null
  clock?: () => number
  log?: WorldRatingLog
}

interface PlatformState {
  lease: RequestLease
  busy: boolean
  lastAttemptAt: number | null
}

interface CachedRating {
  value: WorldRating
  at: number
  generation: number
}

/**
 * The signed-in user's own VRChat world rating. The renderer names a world
 * only by the Explore reference main issued. A read is cached and shared
 * while it is in flight. A write runs only when this is called (a button
 * press), one at a time, sent once and never retried, and never across an
 * account change. ChilloutVR has no such request.
 */
export class WorldRatingService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly cache = new Map<string, CachedRating>()
  private readonly revision = new Map<string, number>()
  private readonly reads = new Map<string, Promise<WorldRatingRead>>()
  private epoch = 0
  private readonly clock: () => number
  private readonly log: WorldRatingLog

  constructor(private readonly options: WorldRatingServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
  }

  async getWorldRating(platform: Platform, worldRef: string): Promise<WorldRatingRead> {
    if (platform !== 'vrchat') return this.denied(platform, 'not-vrchat')
    const ready = this.ready(platform)
    if (!ready) return this.denied(platform, 'not-authenticated')
    const worldId = this.worldId(platform, worldRef)
    if (worldId === null) return this.denied(platform, 'unknown-world')
    const fresh = this.fresh(worldId, ready.lease.generation)
    if (fresh !== undefined) return { ok: true, value: fresh }
    const key = `${ready.lease.generation}:${worldId}`
    const existing = this.reads.get(key)
    if (existing) return existing
    const started = this.epoch
    const revision = this.revision.get(worldId) ?? 0
    const flight = this.load(ready.adapter, ready.lease, worldId, started, revision)
    this.reads.set(key, flight)
    void flight.finally(() => {
      if (this.reads.get(key) === flight) this.reads.delete(key)
    })
    return flight
  }

  async setWorldRating(
    platform: Platform,
    worldRef: string,
    value: WorldRating
  ): Promise<SetWorldRatingResult> {
    if (platform !== 'vrchat') return this.denied(platform, 'not-vrchat')
    const ready = this.ready(platform)
    if (!ready) return this.denied(platform, 'not-authenticated')
    const worldId = this.worldId(platform, worldRef)
    if (worldId === null) return this.denied(platform, 'unknown-world')
    const state = ready.state
    if (
      state.busy ||
      (state.lastAttemptAt !== null &&
        this.clock() - state.lastAttemptAt < WORLD_RATING_WRITE_SPACING_MS)
    ) {
      return this.denied(platform, 'cooldown')
    }
    state.busy = true
    const started = this.epoch
    // A read that is already out must not cache over this press.
    this.revision.set(worldId, (this.revision.get(worldId) ?? 0) + 1)
    try {
      const next = await this.send(ready.adapter, ready.lease, worldId, value)
      if (started !== this.epoch || !ready.lease.isCurrent()) {
        return this.denied(platform, 'stale')
      }
      assertRequestLease(ready.lease)
      this.remember(worldId, ready.lease.generation, next)
      return { ok: true, value: next }
    } catch (error) {
      return this.denied(platform, failureOf(error))
    } finally {
      state.lastAttemptAt = this.clock()
      state.busy = false
    }
  }

  /** Forget VRChat's cached rating at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    if (platform !== 'vrchat') return
    this.epoch += 1
    this.states.delete(platform)
    this.cache.clear()
    this.revision.clear()
    this.reads.clear()
  }

  private async load(
    adapter: WorldRatingAdapter,
    lease: RequestLease,
    worldId: string,
    started: number,
    revision: number
  ): Promise<WorldRatingRead> {
    try {
      const value = await adapter.getWorldRating(worldId, lease)
      if (started !== this.epoch || !lease.isCurrent()) return this.denied('vrchat', 'stale')
      if ((this.revision.get(worldId) ?? 0) !== revision) {
        const kept = this.fresh(worldId, lease.generation)
        return kept !== undefined ? { ok: true, value: kept } : this.denied('vrchat', 'stale')
      }
      assertRequestLease(lease)
      this.remember(worldId, lease.generation, value)
      return { ok: true, value }
    } catch (error) {
      return this.denied('vrchat', failureOf(error))
    }
  }

  private send(
    adapter: WorldRatingAdapter,
    lease: RequestLease,
    worldId: string,
    value: WorldRating
  ): Promise<WorldRating> {
    if (value === null) return adapter.deleteWorldRating(worldId, lease)
    return adapter.setWorldRating(worldId, value, lease)
  }

  private ready(
    platform: Platform
  ): { adapter: WorldRatingAdapter; lease: RequestLease; state: PlatformState } | null {
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return null
    const state = this.stateFor(adapter)
    if (!state) return null
    return { adapter, lease: state.lease, state }
  }

  private stateFor(adapter: WorldRatingAdapter): PlatformState | null {
    let lease: RequestLease
    try {
      lease = adapter.captureWorldRatingLease()
    } catch {
      this.states.delete(adapter.platform)
      return null
    }
    const existing = this.states.get(adapter.platform)
    if (
      existing &&
      existing.lease.generation === lease.generation &&
      existing.lease.isCurrent() &&
      !existing.lease.signal.aborted
    ) {
      return existing
    }
    const state: PlatformState = { lease, busy: false, lastAttemptAt: null }
    this.states.set(adapter.platform, state)
    return state
  }

  private worldId(platform: Platform, worldRef: string): string | null {
    const worldId = this.options.resolveWorld(platform, worldRef)
    if (worldId === null || !isVrchatWorldId(worldId)) return null
    return worldId
  }

  /** `undefined` is a miss. A cached `null` is a real "not rated" answer. */
  private fresh(worldId: string, generation: number): WorldRating | undefined {
    const hit = this.cache.get(worldId)
    if (!hit || hit.generation !== generation) return undefined
    if (this.clock() - hit.at >= WORLD_RATING_CACHE_MS) return undefined
    return hit.value
  }

  private remember(worldId: string, generation: number, value: WorldRating): void {
    this.cache.set(worldId, { value, at: this.clock(), generation })
  }

  private denied<R extends WorldRatingFailure | SetWorldRatingFailure>(
    platform: Platform,
    reason: R
  ): { ok: false; reason: R } {
    this.log('world rating denied', { platform, reason })
    return { ok: false, reason }
  }
}

function failureOf(error: unknown): WorldRatingFailure {
  if (error instanceof RequestCancelledError) return 'stale'
  if (error instanceof AuthError && error.status !== 403) return 'not-authenticated'
  if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
    return 'rate-limited'
  }
  return 'failed'
}
