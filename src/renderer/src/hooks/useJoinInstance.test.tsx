// @vitest-environment jsdom
/**
 * useJoinInstance (VRX-69 review round) — the ONE join flow shared by the row
 * pill and the drawer button. Pins the CROSS-SURFACE in-flight latch (module-
 * scoped: any active join blocks every Join surface, bridge called exactly
 * once) and the failure-blip lifecycle (a new attempt clears the previous
 * blip; a success clears it too).
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { useJoinInstance } from './useJoinInstance'

const friend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance: null,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

let joinInstance: ReturnType<typeof vi.fn>

beforeEach(() => {
  joinInstance = vi.fn().mockResolvedValue({ ok: true })
  window.vrx = { joinInstance } as unknown as Window['vrx']
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useJoinInstance', () => {
  it('cross-surface latch: while ANY join is in flight, every other surface no-ops', async () => {
    let resolveJoin!: (result: { ok: boolean }) => void
    joinInstance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve
        })
    )
    // Two independent hook instances = two Join surfaces (a row + the drawer).
    const surfaceA = renderHook(() => useJoinInstance())
    const surfaceB = renderHook(() => useJoinInstance())

    let firstJoin!: Promise<void>
    act(() => {
      firstJoin = surfaceA.result.current.join(friend)
    })
    // The OTHER surface fires while the first is still pending → no-op.
    await act(async () => {
      await surfaceB.result.current.join(friend)
    })
    expect(joinInstance).toHaveBeenCalledTimes(1) // count, not find

    await act(async () => {
      resolveJoin({ ok: true })
      await firstJoin
    })
    // Latch released — the second surface can join now.
    joinInstance.mockResolvedValue({ ok: true }) // settle immediately this time
    await act(async () => {
      await surfaceB.result.current.join(friend)
    })
    expect(joinInstance).toHaveBeenCalledTimes(2)
  })

  it('a new attempt clears the previous failure blip at the START', async () => {
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'not-joinable' })
    const hook = renderHook(() => useJoinInstance())
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailed).toBe(true)

    let resolveJoin!: (result: { ok: boolean }) => void
    joinInstance.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve
        })
    )
    let retry!: Promise<void>
    act(() => {
      retry = hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailed).toBe(false) // cleared immediately

    await act(async () => {
      resolveJoin({ ok: false })
      await retry
    })
    expect(hook.result.current.joinFailed).toBe(true) // the new denial blips again
  })

  it('a success clears a lingering blip and cancels its timer', async () => {
    vi.useFakeTimers()
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'not-joinable' })
    const hook = renderHook(() => useJoinInstance())
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailed).toBe(true)

    joinInstance.mockResolvedValueOnce({ ok: true })
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailed).toBe(false)

    // The old blip timer is cancelled — nothing flips state later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(hook.result.current.joinFailed).toBe(false)
  })
})
