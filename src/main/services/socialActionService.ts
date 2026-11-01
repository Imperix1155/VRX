import { isCommunityUserId } from '@shared/community'
import {
  RELATIONSHIP_CACHE_MS,
  SOCIAL_ACTION_COOLDOWN_MS,
  type Relationship,
  type RelationshipResult,
  type SocialAction,
  type SocialActionResult,
  type SocialFailure
} from '@shared/socialActions'
import type { Platform } from '@shared/types'
import { SocialNotSentError, type SocialActionAdapter } from './adapters/SocialActionAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

/** Most people whose block answer one session remembers per platform. */
const MAX_REMEMBERED = 100

type SocialLog = (
  message: 'social action failed',
  meta: { platform: Platform; kind: SocialAction | 'relationship'; reason: string }
) => void

export interface SocialActionServiceOptions {
  adapters: ReadonlyMap<Platform, SocialActionAdapter>
  /** Whether the person is on the signed-in user's friends list now. */
  isFriend: (platform: Platform, userId: string) => boolean
  /** Whether a search listed the person this session. */
  isKnownPerson: (platform: Platform, userId: string) => boolean
  clock?: () => number
  log?: SocialLog
}

interface Remembered {
  /** null when the platform did not say. */
  blocked: boolean | null
  /** Set after an unfriend VRX sent, until the roster catches up or the entry ages out. */
  unfriended: boolean
  at: number
}

interface PlatformState {
  lease: RequestLease
  people: Map<string, Remembered>
  pending: Map<string, Promise<boolean | null>>
  /** Count of changes VRX made per person, so an older read never replaces them. */
  writes: Map<string, number>
  /** True while one action on this platform is on its way. */
  busy: boolean
  lastActionAt: number | null
}

/**
 * Main-owned Unfriend, Block and Unblock from a person's full profile. Every
 * write follows a press the user confirmed, names one person, and is never
 * retried on its own. One action per platform at a time, then a short pause,
 * so a stuck or repeated click cannot turn into a burst. Only a friend, or
 * someone a search listed, can be acted on, so the renderer cannot reach
 * arbitrary accounts. Each platform's memory belongs to one session lease.
 */
export class SocialActionService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly log: SocialLog

  constructor(private readonly options: SocialActionServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
  }

  /** Friend and block state, read when the user opens the profile's options. */
  async getRelationship(platform: Platform, userId: string): Promise<RelationshipResult> {
    const target = this.person(platform, userId)
    if (!target.ok) return target
    const { adapter, state, id } = target
    try {
      const blocked = await this.readBlocked(adapter, state, id)
      return { ok: true, relationship: this.relationship(platform, state, id, blocked) }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'relationship', error) }
    }
  }

  async act(platform: Platform, userId: string, action: SocialAction): Promise<SocialActionResult> {
    const target = this.person(platform, userId)
    if (!target.ok) return target
    const { adapter, state, id } = target
    if (action === 'unfriend' && !this.isFriendNow(platform, state, id)) {
      return { ok: false, reason: 'not-friend' }
    }
    const now = this.clock()
    if (
      state.busy ||
      (state.lastActionAt !== null && now - state.lastActionAt < SOCIAL_ACTION_COOLDOWN_MS)
    ) {
      return { ok: false, reason: 'busy' }
    }
    state.busy = true
    state.lastActionAt = now
    try {
      if (action === 'unfriend') await adapter.unfriend(id, state.lease)
      else if (action === 'block') await adapter.block(id, state.lease)
      else await adapter.unblock(id, state.lease)
      assertRequestLease(state.lease)
      state.writes.set(id, (state.writes.get(id) ?? 0) + 1)
      const previous = state.people.get(id)
      const remembered: Remembered = {
        blocked:
          action === 'block' ? true : action === 'unblock' ? false : (previous?.blocked ?? null),
        unfriended: action === 'unfriend' || (previous?.unfriended ?? false),
        at: this.clock()
      }
      this.remember(state, id, remembered)
      return {
        ok: true,
        relationship: this.relationship(platform, state, id, remembered.blocked)
      }
    } catch (error) {
      if (error instanceof SocialNotSentError) {
        this.log('social action failed', { platform, kind: action, reason: 'not-connected' })
        return { ok: false, reason: 'not-connected' }
      }
      return { ok: false, reason: this.failure(platform, action, error) }
    } finally {
      state.busy = false
      // The pause runs from when the platform answered, not from the press.
      if (this.states.get(platform) === state) state.lastActionAt = this.clock()
    }
  }

  /** Forget a platform at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private relationship(
    platform: Platform,
    state: PlatformState,
    id: string,
    blocked: boolean | null
  ): Relationship {
    return { platform, userId: id, isFriend: this.isFriendNow(platform, state, id), blocked }
  }

  private isFriendNow(platform: Platform, state: PlatformState, id: string): boolean {
    const remembered = this.fresh(state.people.get(id))
    // The roster catches up from the platform's own socket message; until then
    // an unfriend VRX just sent still counts.
    if (remembered?.unfriended) return false
    return this.options.isFriend(platform, id)
  }

  private async readBlocked(
    adapter: SocialActionAdapter,
    state: PlatformState,
    id: string
  ): Promise<boolean | null> {
    const cached = this.fresh(state.people.get(id))
    if (cached) return cached.blocked
    const running = state.pending.get(id)
    if (running) return running
    const writesBefore = state.writes.get(id) ?? 0
    const started = (async () => {
      const blocked = await adapter.getBlocked(id, state.lease)
      assertRequestLease(state.lease)
      // A change VRX made while this read was out is newer than its answer.
      if ((state.writes.get(id) ?? 0) !== writesBefore) {
        const written = this.fresh(state.people.get(id))
        if (written) return written.blocked
      }
      if (this.states.get(adapter.platform) === state) {
        this.remember(state, id, { blocked, unfriended: false, at: this.clock() })
      }
      return blocked
    })().finally(() => {
      if (state.pending.get(id) === started) state.pending.delete(id)
    })
    state.pending.set(id, started)
    return started
  }

  private remember(state: PlatformState, id: string, value: Remembered): void {
    state.people.delete(id)
    state.people.set(id, value)
    while (state.people.size > MAX_REMEMBERED) {
      state.people.delete(state.people.keys().next().value!)
    }
  }

  private fresh(value: Remembered | undefined): Remembered | undefined {
    return value !== undefined && this.clock() - value.at < RELATIONSHIP_CACHE_MS
      ? value
      : undefined
  }

  private person(
    platform: Platform,
    userId: string
  ):
    | { ok: true; adapter: SocialActionAdapter; state: PlatformState; id: string }
    | { ok: false; reason: 'not-authenticated' | 'unknown-person' } {
    if (!isCommunityUserId(platform, userId)) return { ok: false, reason: 'unknown-person' }
    // ChilloutVR GUIDs compare case-insensitively; VRChat IDs are kept as sent.
    const id = platform === 'chilloutvr' ? userId.toLowerCase() : userId
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    // Someone VRX already answered for this session (for example a friend who
    // was just unfriended) stays reachable so a block can follow.
    if (
      !session.state.people.has(id) &&
      !this.options.isFriend(platform, id) &&
      !this.options.isKnownPerson(platform, id)
    ) {
      return { ok: false, reason: 'unknown-person' }
    }
    return { ok: true, ...session, id }
  }

  private session(
    platform: Platform
  ): { adapter: SocialActionAdapter; state: PlatformState } | null {
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return null
    let lease: RequestLease
    try {
      lease = adapter.captureSocialLease()
    } catch {
      this.states.delete(platform)
      return null
    }
    const existing = this.states.get(platform)
    if (
      existing &&
      existing.lease.generation === lease.generation &&
      existing.lease.isCurrent() &&
      !existing.lease.signal.aborted
    ) {
      return { adapter, state: existing }
    }
    const state: PlatformState = {
      lease,
      people: new Map(),
      pending: new Map(),
      writes: new Map(),
      busy: false,
      lastActionAt: null
    }
    this.states.set(platform, state)
    return { adapter, state }
  }

  private failure(
    platform: Platform,
    kind: SocialAction | 'relationship',
    error: unknown
  ): SocialFailure {
    const reason: SocialFailure =
      error instanceof AuthError || error instanceof RequestCancelledError
        ? 'not-authenticated'
        : error instanceof RateLimitError || error instanceof RequestQueueFullError
          ? 'rate-limited'
          : 'unavailable'
    this.log('social action failed', { platform, kind, reason })
    return reason
  }
}
