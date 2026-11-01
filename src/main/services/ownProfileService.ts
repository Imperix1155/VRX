import {
  OWN_BIO_MAX_LENGTH,
  OWN_PRONOUNS_MAX_LENGTH,
  OWN_PROFILE_REREAD_MS,
  OWN_PROFILE_SAVE_COOLDOWN_MS,
  OWN_STATUS_TEXT_MAX_LENGTH,
  isOwnStatus,
  normalizeOwnProfileText,
  type OwnProfile,
  type OwnProfileChanges,
  type OwnProfileFailure,
  type OwnProfileResult,
  type SaveOwnProfileResult
} from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import type { OwnProfileAdapter } from './adapters/OwnProfileAdapter'
import { AuthError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type OwnProfileLog = (
  message: 'own profile request failed' | 'own profile save denied',
  meta: { platform: Platform; reason: string }
) => void

export interface OwnProfileServiceOptions {
  adapters: ReadonlyMap<Platform, OwnProfileAdapter>
  clock?: () => number
  log?: OwnProfileLog
}

interface PlatformState {
  lease: RequestLease
  profile: OwnProfile | null
  readAt: number | null
  /** One read at a time; a second ask joins the first. */
  reading: Promise<OwnProfileResult> | null
  saving: boolean
  lastSaveAt: number | null
}

/**
 * Main-owned editing of the signed-in user's own profile. A read follows the
 * editor opening (re-read only once the last answer is 30 s old) and a write
 * follows a Save press. Only fields that differ from the last read go out,
 * one Save per platform at a time, and every attempt, failed or not, starts
 * a 5 s cooldown. Each platform's state belongs to one session lease, so
 * nothing crosses an account boundary. Nothing here runs on a timer.
 */
export class OwnProfileService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly log: OwnProfileLog

  constructor(private readonly options: OwnProfileServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
  }

  getOwnProfile(platform: Platform): Promise<OwnProfileResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return Promise.resolve({ ok: false, reason: 'not-authenticated' })
    if (
      state.profile !== null &&
      state.readAt !== null &&
      this.clock() - state.readAt < OWN_PROFILE_REREAD_MS
    ) {
      return Promise.resolve({ ok: true, profile: state.profile })
    }
    state.reading ??= this.read(adapter, state).finally(() => {
      state.reading = null
    })
    return state.reading
  }

  async saveOwnProfile(platform: Platform, raw: unknown): Promise<SaveOwnProfileResult> {
    const adapter = this.options.adapters.get(platform)
    const state = adapter ? this.stateFor(adapter) : null
    if (!adapter || !state) return this.denied(platform, 'not-authenticated')
    const checked = checkChanges(platform, raw)
    if (checked === null) return this.denied(platform, 'invalid')
    if (
      state.saving ||
      state.reading !== null ||
      (state.lastSaveAt !== null && this.clock() - state.lastSaveAt < OWN_PROFILE_SAVE_COOLDOWN_MS)
    ) {
      return this.denied(platform, 'cooldown')
    }
    state.saving = true
    try {
      // Changes are compared with what the platform holds now. A session
      // renewed since the editor opened has no answer yet: read it first.
      const current: OwnProfileResult = state.profile
        ? { ok: true, profile: state.profile }
        : await this.read(adapter, state)
      if (!current.ok) return current
      const changes = onlyChanged(checked, current.profile)
      if (Object.keys(changes).length === 0) return current
      try {
        const answered = await adapter.saveOwnProfile(changes, state.lease)
        assertRequestLease(state.lease)
        const profile = answered ?? withChanges(current.profile, changes)
        state.profile = profile
        state.readAt = this.clock()
        return { ok: true, profile }
      } catch (error) {
        // Part of a ChilloutVR Save may have gone through, so opening the
        // editor again reads the profile instead of reusing this answer.
        state.readAt = null
        return { ok: false, reason: this.failure(platform, error) }
      } finally {
        state.lastSaveAt = this.clock()
      }
    } finally {
      state.saving = false
    }
  }

  /** Forget a platform's profile at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private async read(adapter: OwnProfileAdapter, state: PlatformState): Promise<OwnProfileResult> {
    try {
      const profile = await adapter.getOwnProfile(state.lease)
      assertRequestLease(state.lease)
      state.profile = profile
      state.readAt = this.clock()
      return { ok: true, profile }
    } catch (error) {
      return { ok: false, reason: this.failure(adapter.platform, error) }
    }
  }

  private stateFor(adapter: OwnProfileAdapter): PlatformState | null {
    let lease: RequestLease
    try {
      lease = adapter.captureOwnProfileLease()
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
      profile: null,
      readAt: null,
      reading: null,
      saving: false,
      lastSaveAt: null
    }
    this.states.set(adapter.platform, state)
    return state
  }

  private failure(platform: Platform, error: unknown): OwnProfileFailure {
    const reason: OwnProfileFailure =
      error instanceof AuthError
        ? 'not-authenticated'
        : error instanceof RateLimitError || error instanceof RequestQueueFullError
          ? 'rate-limited'
          : 'unavailable'
    this.log('own profile request failed', { platform, reason })
    return reason
  }

  private denied(
    platform: Platform,
    reason: Exclude<SaveOwnProfileResult, { ok: true }>['reason']
  ): SaveOwnProfileResult {
    this.log('own profile save denied', { platform, reason })
    return { ok: false, reason }
  }
}

/**
 * The renderer's changes, checked and normalized: known fields only, text
 * within each platform editor's limit, and status fields on VRChat only.
 */
function checkChanges(platform: Platform, raw: unknown): OwnProfileChanges | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const allowed =
    platform === 'vrchat' ? ['bio', 'pronouns', 'status', 'statusText'] : ['bio', 'pronouns']
  if (Object.keys(input).some((key) => !allowed.includes(key))) return null
  const changes: OwnProfileChanges = {}
  if (input.bio !== undefined) {
    const bio = normalizeOwnProfileText(input.bio, OWN_BIO_MAX_LENGTH, true)
    if (bio === null) return null
    changes.bio = bio
  }
  if (input.pronouns !== undefined) {
    const pronouns = normalizeOwnProfileText(input.pronouns, OWN_PRONOUNS_MAX_LENGTH, false)
    if (pronouns === null) return null
    changes.pronouns = pronouns
  }
  if (input.status !== undefined) {
    if (!isOwnStatus(input.status)) return null
    changes.status = input.status
  }
  if (input.statusText !== undefined) {
    const statusText = normalizeOwnProfileText(input.statusText, OWN_STATUS_TEXT_MAX_LENGTH, false)
    if (statusText === null) return null
    changes.statusText = statusText
  }
  return changes
}

function onlyChanged(changes: OwnProfileChanges, current: OwnProfile): OwnProfileChanges {
  const changed: OwnProfileChanges = {}
  if (changes.bio !== undefined && changes.bio !== current.bio) changed.bio = changes.bio
  if (changes.pronouns !== undefined && changes.pronouns !== current.pronouns) {
    changed.pronouns = changes.pronouns
  }
  if (changes.status !== undefined && changes.status !== current.status) {
    changed.status = changes.status
  }
  if (changes.statusText !== undefined && changes.statusText !== current.statusText) {
    changed.statusText = changes.statusText
  }
  return changed
}

/** The profile after a Save whose reply carried none: the last read plus what was sent. */
function withChanges(current: OwnProfile, changes: OwnProfileChanges): OwnProfile {
  return {
    ...current,
    ...(changes.bio !== undefined ? { bio: changes.bio } : {}),
    ...(changes.pronouns !== undefined ? { pronouns: changes.pronouns } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.statusText !== undefined ? { statusText: changes.statusText } : {})
  }
}
