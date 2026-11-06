import type { FriendRoster } from './IPlatformAdapter'
import { assertRequestLease, type RequestLease } from './RequestLease'
import { RateLimitError } from './errors'

interface RunState {
  lease: RequestLease
  dirty: boolean
  finalRead: boolean
  /** A change landed after the final read was sent, so its answer may miss it. */
  stale: boolean
  rateLimitRevision?: number
}

interface Run {
  state: RunState
  promise: Promise<FriendRoster>
}

/**
 * One roster operation per session, including at most one event-driven
 * follow-up. A change during that follow-up makes the next caller wait for the
 * run and then read once more, instead of sharing an answer that may miss it.
 */
export class RosterRefresh {
  private active: Run | null = null

  constructor(
    private readonly read: () => Promise<FriendRoster>,
    private readonly cooldownRemaining: () => number,
    private readonly captureRevision?: () => number | undefined,
    private readonly readRateLimitRevision?: () => number
  ) {}

  get(lease: RequestLease): Promise<FriendRoster> {
    const active = this.active?.state.lease.signal === lease.signal ? this.active : null
    if (active && !active.state.stale) return active.promise
    const state: RunState = { lease, dirty: false, finalRead: false, stale: false }
    const promise = (active ? this.follow(state, active) : this.execute(state)).finally(() => {
      if (this.active?.promise === promise) this.active = null
    })
    this.active = { state, promise }
    return promise
  }

  invalidate(): void {
    const state = this.active?.state
    if (state?.finalRead) state.stale = true
    else if (state) state.dirty = true
  }

  clear(): void {
    this.active = null
  }

  /** One fresh run after `previous`, unless it failed or a 429 touched it. */
  private async follow(state: RunState, previous: Run): Promise<FriendRoster> {
    const settled = await previous.promise
    assertRequestLease(state.lease)
    if (
      settled.rateLimit ||
      this.cooldownRemaining() > 0 ||
      previous.state.rateLimitRevision !== this.readRateLimitRevision?.()
    )
      return settled
    // This run's first read covers every change seen while it waited.
    state.dirty = false
    return this.execute(state)
  }

  private async execute(state: RunState): Promise<FriendRoster> {
    state.rateLimitRevision = this.readRateLimitRevision?.()
    const first = await this.readWithRevision()
    assertRequestLease(state.lease)
    if (
      !state.dirty ||
      first.rateLimit ||
      this.cooldownRemaining() > 0 ||
      state.rateLimitRevision !== this.readRateLimitRevision?.()
    )
      return first
    state.finalRead = true
    try {
      const last = await this.readWithRevision()
      assertRequestLease(state.lease)
      if (last.completeness === 'complete') return last
      const seen = new Set(last.friends.map((friend) => friend.platformUserId))
      return {
        ...last,
        friends: [
          ...last.friends,
          ...first.friends.filter((friend) => !seen.has(friend.platformUserId))
        ],
        ...(first.seeds && last.seeds
          ? { seeds: [...this.partialSeeds(first), ...last.seeds] }
          : {})
      }
    } catch (error) {
      assertRequestLease(state.lease)
      if (!(error instanceof RateLimitError)) throw error
      // A failed follow-up cannot turn an earlier usable snapshot into an
      // authoritative removal or discard it. Never replay this rate-limited run.
      return {
        ...first,
        completeness: 'partial',
        rateLimit: { retryAfterMs: error.retryAfterMs },
        ...(first.seeds ? { seeds: this.partialSeeds(first) } : {})
      }
    }
  }

  private async readWithRevision(): Promise<FriendRoster> {
    const revision = this.captureRevision?.()
    const roster = await this.read()
    return revision === undefined
      ? roster
      : {
          ...roster,
          seeds: [{ revision, friends: roster.friends, completeness: roster.completeness }]
        }
  }

  private partialSeeds(roster: FriendRoster): NonNullable<FriendRoster['seeds']> {
    // A retained first-read omission is older than the final read. Preserve its
    // own fence, and never infer a removal from an overall partial operation.
    return (roster.seeds ?? []).map((seed) => ({ ...seed, completeness: 'partial' }))
  }
}
