import {
  HOME_WORLD_COOLDOWN_MS,
  isHomeWorldId,
  type SetHomeWorldFailure,
  type SetHomeWorldResult
} from '@shared/homeWorld'
import type { Platform } from '@shared/types'
import type { HomeWorldAdapter } from './adapters/HomeWorldAdapter'
import { AuthError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type HomeWorldLog = (
  message: 'home world change denied',
  meta: { platform: Platform; reason: SetHomeWorldFailure }
) => void

export interface HomeWorldServiceOptions {
  adapters: ReadonlyMap<Platform, HomeWorldAdapter>
  /** The world ID behind an Explore reference main issued (`ExploreService.worldIdFor`). */
  resolveWorld: (platform: Platform, worldRef: string) => string | null
  clock?: () => number
  log?: HomeWorldLog
}

interface PlatformState {
  lease: RequestLease
  busy: boolean
  lastAttemptAt: number | null
}

/**
 * Main-owned "Set as home world". The renderer names a world only by the
 * Explore reference main issued, so it can never set an arbitrary ID. One
 * change per platform runs at a time, every attempt (failed or not) starts
 * `HOME_WORLD_COOLDOWN_MS`, and nothing is ever resent on its own. State
 * belongs to one session lease, so a write never crosses an account boundary.
 */
export class HomeWorldService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly log: HomeWorldLog

  constructor(private readonly options: HomeWorldServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
  }

  async setHomeWorld(platform: Platform, worldRef: string): Promise<SetHomeWorldResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return this.denied(platform, 'not-authenticated')
    const worldId = this.options.resolveWorld(platform, worldRef)
    if (worldId === null || !isHomeWorldId(platform, worldId)) {
      return this.denied(platform, 'unknown-world')
    }
    if (
      state.busy ||
      (state.lastAttemptAt !== null && this.clock() - state.lastAttemptAt < HOME_WORLD_COOLDOWN_MS)
    ) {
      return this.denied(platform, 'cooldown')
    }
    state.busy = true
    try {
      await adapter.setHomeWorld(worldId, state.lease)
      assertRequestLease(state.lease)
      return { ok: true, platform, worldId }
    } catch (error) {
      return this.denied(platform, failureOf(error))
    } finally {
      // A failed attempt waits out the cooldown too, so a retry never comes
      // sooner than a successful change would allow.
      state.lastAttemptAt = this.clock()
      state.busy = false
    }
  }

  /** Forget a platform's state at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private stateFor(adapter: HomeWorldAdapter): PlatformState | null {
    let lease: RequestLease
    try {
      lease = adapter.captureHomeWorldLease()
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

  private denied(platform: Platform, reason: SetHomeWorldFailure): SetHomeWorldResult {
    this.log('home world change denied', { platform, reason })
    return { ok: false, reason }
  }
}

function failureOf(error: unknown): SetHomeWorldFailure {
  // A 403 can refuse one change while the session stays valid; only a 401
  // means the user has to sign in again.
  if (error instanceof AuthError && error.status !== 403) return 'not-authenticated'
  if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
    return 'rate-limited'
  }
  return 'failed'
}
