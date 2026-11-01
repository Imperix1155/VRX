/**
 * Friend actions: accept or decline a friend request from the Inbox, or send
 * one from a profile. These are VRX's only friend writes.
 *
 * Every action follows one user press and is sent once; nothing here retries,
 * runs on a timer, or acts in bulk. Main decides what goes out: an answer names
 * an inbox row main holds, and a request names someone a search listed this
 * session who is not already a friend. Actions on one platform go out one at a
 * time, at least FRIEND_ACTION_SPACING_MS apart; a few presses may wait their
 * turn and the rest are refused as `busy`. Each platform's state belongs to one
 * session lease, so a write never lands on another account. Logs carry the
 * platform, action and reason only, never a person or record ID.
 */
import {
  FRIEND_ACTION_MAX_WAITING,
  FRIEND_ACTION_SPACING_MS,
  type FriendActionFailure,
  type FriendActionResult,
  type FriendRequestAnswer
} from '@shared/friendActions'
import { isCommunityUserId } from '@shared/community'
import type { Platform } from '@shared/types'
import {
  FriendActionRefusedError,
  type FriendActionsAdapter,
  type FriendRequestRecord
} from './adapters/FriendActionsAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type FriendAction = FriendRequestAnswer | 'send'

type FriendActionLog = (
  message: 'friend action failed',
  meta: { platform: Platform; action: FriendAction; reason: FriendActionFailure }
) => void

/** People a request went to this session, remembered so a second press sends nothing. */
export const MAX_SENT_FRIEND_REQUESTS = 200

export interface FriendActionsServiceOptions {
  adapters: ReadonlyMap<Platform, FriendActionsAdapter>
  inbox: {
    friendRequest(platform: Platform, id: string): FriendRequestRecord | null
    dismiss(platform: Platform, id: string): boolean
  }
  /** A search listed this person in the current session (`CommunityService`). */
  wasListed: (platform: Platform, userId: string) => boolean
  /** On the signed-in user's friends list now. */
  isFriend: (platform: Platform, userId: string) => boolean
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: FriendActionLog
}

interface PlatformState {
  lease: RequestLease
  /** Settles when the last queued action is done; the next one waits on it. */
  tail: Promise<void>
  /** Actions queued or running. */
  waiting: number
  lastActionAt: number | null
  /** One run per row or person at a time; a second press joins it. */
  running: Map<string, Promise<FriendActionResult>>
  sent: Set<string>
}

export class FriendActionsService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: FriendActionLog

  constructor(private readonly options: FriendActionsServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()))
    this.log = options.log ?? (() => undefined)
  }

  answer(platform: Platform, id: string, answer: FriendRequestAnswer): Promise<FriendActionResult> {
    const session = this.session(platform)
    if (!session) return this.denied(platform, answer, 'not-authenticated')
    const { adapter, state } = session
    if (this.options.inbox.friendRequest(platform, id) === null) {
      return this.denied(platform, answer, 'unknown-request')
    }
    // Never hold a press for a connection that is down; the adapter checks
    // again when the press's turn comes.
    if (!adapter.canSendFriendAction()) return this.denied(platform, answer, 'unavailable')
    return this.once(state, `answer:${id}`, () =>
      this.queue(platform, answer, state, async () => {
        // The row may have settled while this press waited its turn.
        const record = this.options.inbox.friendRequest(platform, id)
        if (record === null) return this.fail(platform, answer, 'unknown-request')
        await adapter.answerFriendRequest(record, answer, state.lease)
        assertRequestLease(state.lease)
        this.options.inbox.dismiss(platform, id)
        return { ok: true }
      })
    )
  }

  send(platform: Platform, userId: string): Promise<FriendActionResult> {
    if (!isCommunityUserId(platform, userId)) return this.denied(platform, 'send', 'unknown-person')
    // ChilloutVR GUIDs compare case-insensitively; VRChat IDs are kept as sent.
    const id = platform === 'chilloutvr' ? userId.toLowerCase() : userId
    const session = this.session(platform)
    if (!session) return this.denied(platform, 'send', 'not-authenticated')
    const { adapter, state } = session
    if (this.options.isFriend(platform, id)) return this.denied(platform, 'send', 'already-friends')
    if (!this.options.wasListed(platform, id))
      return this.denied(platform, 'send', 'unknown-person')
    // Asked once this session already: say so again without a second request.
    if (state.sent.has(id)) return Promise.resolve({ ok: true })
    if (!adapter.canSendFriendAction()) return this.denied(platform, 'send', 'unavailable')
    return this.once(state, `send:${id}`, () =>
      this.queue(platform, 'send', state, async () => {
        if (state.sent.has(id)) return { ok: true }
        await adapter.sendFriendRequest(id, state.lease)
        assertRequestLease(state.lease)
        state.sent.add(id)
        while (state.sent.size > MAX_SENT_FRIEND_REQUESTS) {
          state.sent.delete(state.sent.values().next().value!)
        }
        return { ok: true }
      })
    )
  }

  /** Forget a platform's state at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private once(
    state: PlatformState,
    key: string,
    start: () => Promise<FriendActionResult>
  ): Promise<FriendActionResult> {
    const existing = state.running.get(key)
    if (existing) return existing
    const run = start().finally(() => {
      if (state.running.get(key) === run) state.running.delete(key)
    })
    state.running.set(key, run)
    return run
  }

  private async queue(
    platform: Platform,
    action: FriendAction,
    state: PlatformState,
    run: () => Promise<FriendActionResult>
  ): Promise<FriendActionResult> {
    if (state.waiting >= FRIEND_ACTION_MAX_WAITING) return this.fail(platform, action, 'busy')
    state.waiting += 1
    const previous = state.tail
    let release!: () => void
    state.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous
      if (state.lastActionAt !== null) {
        const wait = state.lastActionAt + FRIEND_ACTION_SPACING_MS - this.clock()
        if (wait > 0) await this.sleep(wait)
      }
      if (!this.isCurrent(platform, state)) return this.fail(platform, action, 'not-authenticated')
      try {
        return await run()
      } catch (error) {
        return this.fail(platform, action, failureOf(error))
      } finally {
        // A failed attempt waits out the spacing too.
        state.lastActionAt = this.clock()
      }
    } finally {
      state.waiting -= 1
      release()
    }
  }

  private isCurrent(platform: Platform, state: PlatformState): boolean {
    return (
      this.states.get(platform) === state && state.lease.isCurrent() && !state.lease.signal.aborted
    )
  }

  private session(
    platform: Platform
  ): { adapter: FriendActionsAdapter; state: PlatformState } | null {
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return null
    let lease: RequestLease
    try {
      lease = adapter.captureFriendActionLease()
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
      tail: Promise.resolve(),
      waiting: 0,
      lastActionAt: null,
      running: new Map(),
      sent: new Set()
    }
    this.states.set(platform, state)
    return { adapter, state }
  }

  private fail(
    platform: Platform,
    action: FriendAction,
    reason: FriendActionFailure
  ): FriendActionResult {
    this.log('friend action failed', { platform, action, reason })
    return { ok: false, reason }
  }

  private denied(
    platform: Platform,
    action: FriendAction,
    reason: FriendActionFailure
  ): Promise<FriendActionResult> {
    return Promise.resolve(this.fail(platform, action, reason))
  }
}

function failureOf(error: unknown): FriendActionFailure {
  if (error instanceof AuthError || error instanceof RequestCancelledError) {
    return 'not-authenticated'
  }
  if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
    return 'rate-limited'
  }
  if (error instanceof FriendActionRefusedError) return 'refused'
  return 'unavailable'
}
