import { describe, expect, it, vi } from 'vitest'
import { fullFriend } from '../../../renderer/src/test-utils/friendFixture'
import type { FriendRoster } from './IPlatformAdapter'
import type { RequestLease } from './RequestLease'
import { RateLimitError, RequestCancelledError } from './errors'
import { RosterRefresh } from './RosterRefresh'

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
    for (let i = 0; i < 100; i++) {
      refresh.invalidate()
      expect(refresh.get(owner)).toBe(request)
    }
    const final = roster('Last')
    last.resolve(final)
    await expect(request).resolves.toBe(final)
    expect(read).toHaveBeenCalledTimes(2)
    read.mockResolvedValue(roster('Later'))
    await expect(refresh.get(owner)).resolves.toEqual(roster('Later'))
    expect(read).toHaveBeenCalledTimes(3)
  })

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
