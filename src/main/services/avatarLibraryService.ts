import {
  AVATAR_SWITCH_COOLDOWN_MS,
  isAvatarId,
  type AvatarDetailsResult,
  type AvatarItem,
  type AvatarLibraryFailure,
  type AvatarLibraryResult,
  type AvatarSwitchResult
} from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import type { AvatarLibraryAdapter } from './adapters/AvatarLibraryAdapter'
import { byNewestChange } from './adapters/avatarItemFields'
import { AuthError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type AvatarLog = (
  message: 'avatar library request failed' | 'avatar switch denied',
  meta: { platform: Platform; reason: string }
) => void

export interface AvatarLibraryServiceOptions {
  adapters: ReadonlyMap<Platform, AvatarLibraryAdapter>
  clock?: () => number
  log?: AvatarLog
}

interface PlatformState {
  lease: RequestLease
  /** Avatars main listed for this session: the only ones a switch may name. */
  known: Map<string, AvatarItem>
  /** Fuller records read on demand (ChilloutVR lists carry no dates). */
  details: Map<string, AvatarItem>
  listing: Promise<AvatarLibraryResult> | null
  /** A read for this session finished, so `known` reflects the platform. */
  listed: boolean
  /** `whenListed` already started its one read for this session. */
  implicitRead: boolean
  switching: boolean
  lastSwitchAt: number | null
}

/**
 * Main-owned avatar library. Reads run only when the renderer asks (the
 * Avatars page opening or a Refresh press); nothing here runs on a timer.
 * Each platform's state belongs to one session lease, so a reply or a switch
 * can never cross an account boundary, and the renderer can only switch to an
 * avatar main itself listed for the current session. One switch per platform
 * runs at a time, and every attempt, failed or not, starts
 * `AVATAR_SWITCH_COOLDOWN_MS`.
 */
export class AvatarLibraryService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly log: AvatarLog

  constructor(private readonly options: AvatarLibraryServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
  }

  getLibrary(platform: Platform): Promise<AvatarLibraryResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return Promise.resolve({ ok: false, reason: 'not-authenticated' })
    return this.list(adapter, state)
  }

  async getDetails(platform: Platform, avatarId: string): Promise<AvatarDetailsResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return { ok: false, reason: 'not-authenticated' }
    const id = normalizeId(platform, avatarId)
    if (id !== null) await this.whenListed(adapter, state, id)
    const known = id === null ? undefined : state.known.get(id)
    if (id === null || !known) return { ok: false, reason: 'unknown-avatar' }
    const cached = state.details.get(id)
    if (cached) return { ok: true, avatar: cached }
    // VRChat lists already carry every field the details panel shows.
    if (hasDetails(known)) return { ok: true, avatar: known }
    try {
      const fetched = await adapter.getAvatarDetails(id, state.lease)
      assertRequestLease(state.lease)
      if (!fetched) return { ok: false, reason: 'unavailable' }
      const avatar: AvatarItem = {
        ...fetched,
        imageUrl: fetched.imageUrl ?? known.imageUrl,
        authorName: fetched.authorName ?? known.authorName,
        description: fetched.description ?? known.description
      }
      if (this.states.get(platform) === state) state.details.set(id, avatar)
      return { ok: true, avatar }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, error) }
    }
  }

  async switchAvatar(platform: Platform, avatarId: string): Promise<AvatarSwitchResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return this.denied(platform, 'not-authenticated')
    const id = normalizeId(platform, avatarId)
    if (id !== null) await this.whenListed(adapter, state, id)
    if (id === null || !state.known.has(id)) return this.denied(platform, 'unknown-avatar')
    if (
      state.switching ||
      (state.lastSwitchAt !== null && this.clock() - state.lastSwitchAt < AVATAR_SWITCH_COOLDOWN_MS)
    ) {
      return this.denied(platform, 'cooldown')
    }
    state.switching = true
    try {
      await adapter.switchAvatar(id, state.lease)
      assertRequestLease(state.lease)
      return { ok: true }
    } catch (error) {
      const reason = this.failure(platform, error)
      return this.denied(
        platform,
        reason === 'unavailable' ? 'switch-failed' : reason,
        // `failure` already logged it.
        false
      )
    } finally {
      // A failed attempt waits out the cooldown too, so a retry never comes
      // sooner than a successful switch would allow.
      state.lastSwitchAt = this.clock()
      state.switching = false
    }
  }

  /** Forget a platform's avatars at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private list(adapter: AvatarLibraryAdapter, state: PlatformState): Promise<AvatarLibraryResult> {
    state.listing ??= this.readLibrary(adapter, state).finally(() => {
      state.listing = null
    })
    return state.listing
  }

  /**
   * The renderer keeps a loaded library for the whole session and shows it
   * while a fresh read runs, so a Wear press or a details open can name an
   * avatar before this session's list has come back (or after a session
   * renewal started a new one). Wait for that read instead of refusing; when
   * none has run yet, run the one read the page would have made anyway. At
   * most one such read per session, whatever its outcome: afterwards an
   * unlisted ID is refused at once, so a bad ID can never trigger repeated
   * reads.
   */
  private async whenListed(
    adapter: AvatarLibraryAdapter,
    state: PlatformState,
    id: string
  ): Promise<void> {
    if (state.known.has(id)) return
    if (state.listing !== null) {
      await state.listing
      return
    }
    if (state.listed || state.implicitRead) return
    state.implicitRead = true
    await this.list(adapter, state)
  }

  private async readLibrary(
    adapter: AvatarLibraryAdapter,
    state: PlatformState
  ): Promise<AvatarLibraryResult> {
    const platform = adapter.platform
    try {
      // The worn-avatar read queues beside the list instead of after its last
      // page. Both share the platform's one-request-per-second line, so this
      // only saves the wait for a reply, never sends anything sooner.
      const currentRead = adapter.getCurrentAvatar(state.lease).then(
        (avatar) => ({ ok: true as const, avatar }),
        (error: unknown) => ({ ok: false as const, error })
      )
      const own = await adapter.getOwnAvatars(state.lease)
      const currentResult = await currentRead
      let current: AvatarItem | null = null
      if (currentResult.ok) {
        current = currentResult.avatar
      } else {
        // The list is still useful without the worn avatar; a sign-in or
        // rate-limit failure is not, so those end the whole read.
        if (isTerminal(currentResult.error)) throw currentResult.error
        this.log('avatar library request failed', { platform, reason: 'current-avatar' })
      }
      assertRequestLease(state.lease)
      const avatars = byNewestChange(own.avatars)
      const owned = new Map(avatars.map((avatar) => [avatar.avatarId, avatar]))
      // The worn avatar may be someone else's public one; it is still a valid
      // switch target, so it joins the known set. An owned record wins: it
      // carries more fields than the current-avatar reply.
      const worn = current ? (owned.get(current.avatarId) ?? current) : null
      state.known = new Map(owned)
      if (worn) state.known.set(worn.avatarId, worn)
      state.listed = true
      return { ok: true, platform, avatars, complete: own.complete, current: worn }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, error) }
    }
  }

  private stateFor(adapter: AvatarLibraryAdapter): PlatformState | null {
    let lease: RequestLease
    try {
      lease = adapter.captureAvatarLease()
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
    const state: PlatformState = {
      lease,
      known: new Map(),
      details: new Map(),
      listing: null,
      listed: false,
      implicitRead: false,
      switching: false,
      lastSwitchAt: null
    }
    this.states.set(adapter.platform, state)
    return state
  }

  private failure(platform: Platform, error: unknown): AvatarLibraryFailure {
    const reason: AvatarLibraryFailure =
      error instanceof AuthError
        ? 'not-authenticated'
        : error instanceof RateLimitError || error instanceof RequestQueueFullError
          ? 'rate-limited'
          : 'unavailable'
    this.log('avatar library request failed', { platform, reason })
    return reason
  }

  private denied(
    platform: Platform,
    reason: Exclude<AvatarSwitchResult, { ok: true }>['reason'],
    log = true
  ): AvatarSwitchResult {
    if (log) this.log('avatar switch denied', { platform, reason })
    return { ok: false, reason }
  }
}

function normalizeId(platform: Platform, avatarId: string): string | null {
  if (!isAvatarId(platform, avatarId)) return null
  // ChilloutVR GUIDs compare case-insensitively; VRChat IDs are kept as sent.
  return platform === 'chilloutvr' ? avatarId.toLowerCase() : avatarId
}

function hasDetails(avatar: AvatarItem): boolean {
  return avatar.createdAt !== null || avatar.updatedAt !== null || avatar.visibility !== null
}

function isTerminal(error: unknown): boolean {
  return (
    error instanceof AuthError ||
    error instanceof RateLimitError ||
    error instanceof RequestQueueFullError
  )
}
