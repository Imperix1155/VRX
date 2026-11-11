import { describe, expect, it, vi } from 'vitest'
import { fullFriend } from '../../../renderer/src/test-utils/friendFixture'
import type { FriendRoster } from './IPlatformAdapter'
import type { RequestLease } from './RequestLease'
import { RateLimitError, RequestCancelledError } from './errors'
import { RosterRefresh, type RosterReadHooks } from './RosterRefresh'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function lease(generation = 0): RequestLease & { abort(): void } {
  const controller = new AbortController()
  return {
    generation,
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted,
    abort: () => controller.abort()
  }
}

const roster = (name: string): FriendRoster => ({
  friends: [fullFriend(name, 'vrchat')],
  completeness: 'complete'
})

describe('RosterRefresh', () => {
  it('reads once when a change lands before the read has asked anything', async () => {
    const answer = deferred<FriendRoster>()
    let sent: () => void = () => undefined
    const read = vi.fn((hooks: RosterReadHooks) => {
      sent = hooks.startsEmpty()
      return answer.promise
    })
    const refresh = new RosterRefresh(read, () => 0)
    const owner = lease()
    const request = refresh.get(owner)
    refresh.invalidate()
    expect(refresh.get(owner)).toBe(request)
    sent()
    const only = roster('Only')
    answer.resolve(only)
    await expect(request).resolves.toBe(only)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('still reads again for a change that lands after the first request went out', async () => {
    const first = deferred<FriendRoster>()
    const last = deferred<FriendRoster>()
    let sent: () => void = () => undefined
    const read = vi
      .fn<(hooks: RosterReadHooks) => Promise<FriendRoster>>()
      .mockImplementationOnce((hooks) => {
        sent = hooks.startsEmpty()
        return first.promise
      })
      .mockImplementationOnce(() => last.promise)
    const refresh = new RosterRefresh(read, () => 0)
    const request = refresh.get(lease())
    sent()
    refresh.invalidate()
    first.resolve(roster('First'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    const final = roster('Last')
    last.resolve(final)
    await expect(request).resolves.toBe(final)
  })

  it('does not carry an unsent mark from one read into the next', async () => {
    const first = deferred<FriendRoster>()
    const last = deferred<FriendRoster>()
    const read = vi
      .fn<(hooks: RosterReadHooks) => Promise<FriendRoster>>()
      .mockImplementationOnce((hooks) => {
        // Never reports its first request; the answer landing ends the mark.
        hooks.startsEmpty()
        return first.promise
      })
      .mockImplementationOnce(() => last.promise)
      .mockImplementationOnce(() => Promise.resolve(roster('Follow-up')))
    const refresh = new RosterRefresh(read, () => 0)
    const owner = lease()
    const one = refresh.get(owner)
    first.resolve(roster('First'))
    await one
    const two = refresh.get(owner)
    refresh.invalidate()
    last.resolve(roster('Last'))
    await two
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('takes the seed revision again when an empty read sends its first request', async () => {
    const answer = deferred<FriendRoster>()
    let sent: () => void = () => undefined
    let clock = 0
    const read = vi.fn((hooks: RosterReadHooks) => {
      sent = hooks.startsEmpty()
      return answer.promise
    })
    const refresh = new RosterRefresh(
      read,
      () => 0,
      () => ++clock
    )
    const request = refresh.get(lease())
    // A socket goes live while the read waits its turn: main's fence moves on.
    const liveAt = ++clock
    refresh.invalidate()
    sent()
    // A later page of the same read reports too; the revision stays put.
    sent()
    answer.resolve(roster('Only'))
    const result = await request
    expect(result.seeds).toHaveLength(1)
    expect(result.seeds?.[0]?.revision).toBe(liveAt + 1)
    expect(clock).toBe(liveAt + 1)
  })

  it('keeps the first revision for a read that starts from a saved answer', async () => {
    let clock = 0
    const refresh = new RosterRefresh(
      () => Promise.resolve(roster('Saved')),
      () => 0,
      () => ++clock
    )
    const result = await refresh.get(lease())
    expect(result.seeds?.[0]?.revision).toBe(1)
    expect(clock).toBe(1)
  })

  it('returns one final result for an event storm, with at most one follow-up', async () => {
    const first = deferred<FriendRoster>()
    const last = deferred<FriendRoster>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const refresh = new RosterRefresh(read, () => 0)
    const owner = lease()
    const request = refresh.get(owner)
    for (let i = 0; i < 100; i++) {
      refresh.invalidate()
      expect(refresh.get(owner)).toBe(request)
    }
    first.resolve(roster('First'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    for (let i = 0; i < 100; i++) expect(refresh.get(owner)).toBe(request)
    const final = roster('Last')
    last.resolve(final)
    await expect(request).resolves.toBe(final)
    expect(read).toHaveBeenCalledTimes(2)
    read.mockResolvedValue(roster('Later'))
    await expect(refresh.get(owner)).resolves.toEqual(roster('Later'))
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('reads once more for callers after a change that lands during the final read', async () => {
    const first = deferred<FriendRoster>()
    const last = deferred<FriendRoster>()
    const read = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise)
      .mockResolvedValue(roster('Fresh'))
    const refresh = new RosterRefresh(read, () => 0)
    const owner = lease()
    const request = refresh.get(owner)
    refresh.invalidate()
    first.resolve(roster('First'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    // With no newer change, callers still share the final read.
    expect(refresh.get(owner)).toBe(request)
    refresh.invalidate()
    const later = refresh.get(owner)
    expect(later).not.toBe(request)
    for (let i = 0; i < 100; i++) {
      refresh.invalidate()
      expect(refresh.get(owner)).toBe(later)
    }
    // Nothing more goes out while the final read is still open.
    expect(read).toHaveBeenCalledTimes(2)
    last.resolve(roster('Last'))
    await expect(request).resolves.toEqual(roster('Last'))
    await expect(later).resolves.toEqual(roster('Fresh'))
    expect(read).toHaveBeenCalledTimes(3)
  })

  it.each(['rate-limited', 'cooldown', 'failed'] as const)(
    'does not read again after a %s final read',
    async (mode) => {
      const first = deferred<FriendRoster>()
      const last = deferred<FriendRoster>()
      const read = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(last.promise)
        .mockResolvedValue(roster('Fresh'))
      let cooldown = 0
      const refresh = new RosterRefresh(read, () => cooldown)
      const owner = lease()
      const request = refresh.get(owner).catch((error: unknown) => error)
      refresh.invalidate()
      first.resolve(roster('First'))
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      refresh.invalidate()
      const later = refresh.get(owner).catch((error: unknown) => error)
      if (mode === 'rate-limited') last.reject(new RateLimitError(60_000))
      else if (mode === 'failed') last.reject(new Error('network'))
      else {
        cooldown = 60_000
        last.resolve(roster('Last'))
      }
      // The caller gets the run it waited on, never a resend after a 429 or failure.
      expect(await later).toEqual(await request)
      expect(read).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['partial', 'throw', 'cooldown'] as const)(
    'does not replay after primary %s rate limiting',
    async (mode) => {
      const first = deferred<FriendRoster>()
      const read = vi.fn().mockReturnValue(first.promise)
      const refresh = new RosterRefresh(read, () => (mode === 'cooldown' ? 60_000 : 0))
      const request = refresh.get(lease()).catch((error: unknown) => error)
      refresh.invalidate()
      if (mode === 'throw') first.reject(new RateLimitError(60_000))
      else
        first.resolve({
          ...roster('First'),
          ...(mode === 'partial'
            ? ({ completeness: 'partial', rateLimit: { retryAfterMs: 60_000 } } as const)
            : {})
        })
      await request
      expect(read).toHaveBeenCalledOnce()
    }
  )

  it('drops a dirty follow-up after a shared zero-delay 429 but allows a fresh read', async () => {
    const first = deferred<FriendRoster>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(roster('Later'))
    let rateLimitRevision = 0
    const refresh = new RosterRefresh(
      read,
      () => 0,
      undefined,
      () => rateLimitRevision
    )
    const owner = lease()
    const request = refresh.get(owner)
    refresh.invalidate()
    rateLimitRevision++
    const completed = roster('First')
    first.resolve(completed)
    await expect(request).resolves.toBe(completed)
    expect(read).toHaveBeenCalledOnce()
    await expect(refresh.get(owner)).resolves.toEqual(roster('Later'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('preserves usable data as partial when the follow-up rate limits', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(roster('First'))
      .mockRejectedValueOnce(new RateLimitError(60_000))
    const refresh = new RosterRefresh(read, () => 0)
    const request = refresh.get(lease())
    refresh.invalidate()
    await expect(request).resolves.toEqual({
      ...roster('First'),
      completeness: 'partial',
      rateLimit: { retryAfterMs: 60_000 }
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('retains first-read omissions when the final read is partial', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(roster('First'))
      .mockResolvedValueOnce({ ...roster('Last'), completeness: 'partial' })
    const refresh = new RosterRefresh(read, () => 0)
    const request = refresh.get(lease())
    refresh.invalidate()
    await expect(request).resolves.toEqual({
      friends: [...roster('Last').friends, ...roster('First').friends],
      completeness: 'partial'
    })
  })

  it('cleans rejection for a later request without an automatic follow-up', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(roster('Later'))
    const refresh = new RosterRefresh(read, () => 0)
    const owner = lease()
    const request = refresh.get(owner)
    refresh.invalidate()
    await expect(request).rejects.toThrow('network')
    expect(read).toHaveBeenCalledOnce()
    await expect(refresh.get(owner)).resolves.toEqual(roster('Later'))
  })

  it('cannot satisfy or clear a replacement session when old work settles', async () => {
    const first = deferred<FriendRoster>()
    const last = deferred<FriendRoster>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const refresh = new RosterRefresh(read, () => 0)
    const oldLease = lease()
    const old = refresh.get(oldLease).catch((error: unknown) => error)
    refresh.invalidate()
    oldLease.abort()
    refresh.clear()
    const newLease = lease(1)
    const current = refresh.get(newLease)
    first.resolve(roster('Old account'))
    expect(await old).toBeInstanceOf(RequestCancelledError)
    expect(refresh.get(newLease)).toBe(current)
    last.resolve(roster('New account'))
    await expect(current).resolves.toEqual(roster('New account'))
    expect(read).toHaveBeenCalledTimes(2)
  })
})
