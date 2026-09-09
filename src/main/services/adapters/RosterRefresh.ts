import type { FriendRoster } from './IPlatformAdapter'
import { assertRequestLease, type RequestLease } from './RequestLease'
import { RateLimitError } from './errors'

interface RunState {
  lease: RequestLease
  dirty: boolean
  finalRead: boolean
}

/** One roster operation per session, including at most one event-driven follow-up. */
export class RosterRefresh {
  private active: { state: RunState; promise: Promise<FriendRoster> } | null = null

  constructor(
    private readonly read: () => Promise<FriendRoster>,
    private readonly cooldownRemaining: () => number
  ) {}

  get(lease: RequestLease): Promise<FriendRoster> {
    if (this.active?.state.lease.signal === lease.signal) return this.active.promise
    const state = { lease, dirty: false, finalRead: false }
    const promise = this.execute(state).finally(() => {
      if (this.active?.promise === promise) this.active = null
    })
    this.active = { state, promise }
    return promise
  }

  invalidate(): void {
    if (this.active && !this.active.state.finalRead) this.active.state.dirty = true
  }

  clear(): void {
    this.active = null
  }

  private async execute(state: RunState): Promise<FriendRoster> {
    const first = await this.read()
    assertRequestLease(state.lease)
    if (!state.dirty || first.rateLimit || this.cooldownRemaining() > 0) return first
    state.finalRead = true
    try {
      const last = await this.read()
      assertRequestLease(state.lease)
      if (last.completeness === 'complete') return last
      const seen = new Set(last.friends.map((friend) => friend.platformUserId))
      return {
        ...last,
        friends: [
          ...last.friends,
          ...first.friends.filter((friend) => !seen.has(friend.platformUserId))
        ]
      }
    } catch (error) {
      assertRequestLease(state.lease)
      if (!(error instanceof RateLimitError)) throw error
      // A failed follow-up cannot turn an earlier usable snapshot into an
      // authoritative removal or discard it. Never replay this rate-limited run.
      return { ...first, completeness: 'partial', rateLimit: { retryAfterMs: error.retryAfterMs } }
    }
  }
}
