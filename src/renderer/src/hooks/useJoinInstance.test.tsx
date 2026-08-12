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
import type { Friend, InstanceInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { queryClient } from '../queries/queryClient'
import { friendsQueryKey } from '../queries/friends'
import { useJoinInstance } from './useJoinInstance'

const publicInstance: InstanceInfo = {
  worldId: 'wrld_fixture',
  instanceId: '12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  groupId: null,
  groupImageUrl: null,
  region: 'us',
  userCount: 14
}

const friend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance: publicInstance,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

let joinInstance: ReturnType<typeof vi.fn>

beforeEach(() => {
  joinInstance = vi.fn().mockResolvedValue({ ok: true })
  window.vrx = { joinInstance } as unknown as Window['vrx']
  // These tests pin the JOIN MECHANICS (latch + blips), so they run with the
  // VRX-210 confirmation gate OFF — the gate itself is covered by
  // JoinConfirmDialog.test.tsx.
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, confirmJoin: false }, dirty: false })
  queryClient.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // The join store is module-level: close any parked confirmation so an open
  // dialog never leaks into the next test.
  const { result } = renderHook(() => useJoinInstance())
  act(() => result.current.cancelPending())
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
    // Visual-disable proof (shared external store): while surface A joins,
    // EVERY surface reports isJoining — no enabled-looking button whose
    // click would silently no-op.
    expect(surfaceA.result.current.isJoining).toBe(true)
    expect(surfaceB.result.current.isJoining).toBe(true)
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
    expect(hook.result.current.joinFailedFor(friend)).toBe(true)

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
    expect(hook.result.current.joinFailedFor(friend)).toBe(false) // cleared immediately

    await act(async () => {
      resolveJoin({ ok: false })
      await retry
    })
    expect(hook.result.current.joinFailedFor(friend)).toBe(true) // the new denial blips again
  })

  it('a success clears a lingering blip and cancels its timer — on EVERY surface', async () => {
    vi.useFakeTimers()
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'not-joinable' })
    const hook = renderHook(() => useJoinInstance())
    const otherSurface = renderHook(() => useJoinInstance())
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailedFor(friend)).toBe(true)
    // ONE blip state rules all surfaces (shared external store).
    expect(otherSurface.result.current.joinFailedFor(friend)).toBe(true)

    joinInstance.mockResolvedValueOnce({ ok: true })
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailedFor(friend)).toBe(false)
    expect(otherSurface.result.current.joinFailedFor(friend)).toBe(false)

    // The old blip timer is cancelled — nothing flips state later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(hook.result.current.joinFailedFor(friend)).toBe(false)
  })

  it('a denial blips ONLY the friend that failed (attributable blip)', async () => {
    const bea: Friend = { ...friend, platformUserId: 'usr_bea', displayName: 'Bea' }
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'not-joinable' })
    const hook = renderHook(() => useJoinInstance())
    await act(async () => {
      await hook.result.current.join(friend)
    })
    expect(hook.result.current.joinFailedFor(friend)).toBe(true)
    expect(hook.result.current.joinFailedFor(bea)).toBe(false)
    // Same id on the OTHER platform must not blip either (composite key).
    const cvrTwin = {
      ...friend,
      platform: 'chilloutvr',
      status: null,
      statusDescription: null,
      trustRank: null
    } as Friend
    expect(hook.result.current.joinFailedFor(cvrTwin)).toBe(false)
  })

  it.each(['stale', 'cooldown', 'rate-limited'] as const)(
    'retains the typed %s denial reason for the failed friend',
    async (reason) => {
      joinInstance.mockResolvedValueOnce({ ok: false, reason })
      const hook = renderHook(() => useJoinInstance())

      await act(async () => {
        await hook.result.current.join(friend)
      })

      expect(hook.result.current.joinFailureFor(friend)).toBe(reason)
    }
  )

  it('confirmation gate: join parks pendingConfirm and confirmPending sends expectedTarget', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: true },
      dirty: false
    })
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friend])
    const hook = renderHook(() => useJoinInstance())

    await act(async () => {
      await hook.result.current.join(friend)
    })

    expect(hook.result.current.pendingConfirm).not.toBeNull()
    expect(hook.result.current.pendingConfirm?.reviewedTarget).toEqual(
      expect.objectContaining({
        worldId: 'wrld_fixture',
        instanceId: '12345~public'
      })
    )

    await act(async () => {
      const result = await hook.result.current.confirmPending('desktop')
      expect(result).toBe('joined')
    })

    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'vrchat',
        friendId: 'usr_alex',
        mode: 'desktop',
        expectedTarget: {
          worldId: 'wrld_fixture',
          instanceId: '12345~public'
        }
      })
    )
    expect(hook.result.current.pendingConfirm).toBeNull()
  })

  it('confirmPending returns review-required on target-changed and arms awaitingCacheAfter', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: true },
      dirty: false
    })
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friend])
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'target-changed' })
    const hook = renderHook(() => useJoinInstance())

    await act(async () => {
      await hook.result.current.join(friend)
    })

    let result: string | null = null
    await act(async () => {
      result = await hook.result.current.confirmPending('desktop')
    })

    expect(result).toBe('review-required')
    expect(hook.result.current.pendingConfirm?.awaitingCacheAfter).not.toBeNull()
    expect(joinInstance).toHaveBeenCalledOnce()
  })

  it('confirmPending returns unavailable when the live friend is no longer joinable', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: true },
      dirty: false
    })
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friend])
    const hook = renderHook(() => useJoinInstance())

    await act(async () => {
      await hook.result.current.join(friend)
    })

    queryClient.setQueryData(friendsQueryKey('vrchat'), [{ ...friend, status: 'ask-me' as const }])
    let result: string | null = null
    await act(async () => {
      result = await hook.result.current.confirmPending('desktop')
    })

    expect(result).toBe('unavailable')
    expect(joinInstance).not.toHaveBeenCalled()
  })

  it('acknowledgePendingTarget accepts the live target and clears awaitingCacheAfter', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: true },
      dirty: false
    })
    const moved: Friend = {
      ...friend,
      instance: { ...publicInstance, worldId: 'wrld_moved', instanceId: '999~public' }
    }
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friend])
    joinInstance.mockResolvedValueOnce({ ok: false, reason: 'target-changed' })
    const hook = renderHook(() => useJoinInstance())

    await act(async () => {
      await hook.result.current.join(friend)
      await hook.result.current.confirmPending('desktop')
    })

    // Cache catches up to the moved target.
    queryClient.setQueryData(friendsQueryKey('vrchat'), [moved])
    await act(async () => await Promise.resolve())

    let accepted = false
    act(() => {
      accepted = hook.result.current.acknowledgePendingTarget()
    })
    expect(accepted).toBe(true)
    expect(hook.result.current.pendingConfirm?.reviewedTarget).toEqual(
      expect.objectContaining({ worldId: 'wrld_moved', instanceId: '999~public' })
    )
    expect(hook.result.current.pendingConfirm?.awaitingCacheAfter).toBeNull()
  })

  it('invalidatePending clears pendingConfirm even while joining', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: true },
      dirty: false
    })
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friend])
    let resolveJoin!: () => void
    joinInstance.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve
        })
    )
    const hook = renderHook(() => useJoinInstance())

    await act(async () => {
      await hook.result.current.join(friend)
    })

    let confirmPromise: Promise<string> | null = null
    act(() => {
      confirmPromise = hook.result.current.confirmPending('desktop')
    })
    expect(hook.result.current.isJoining).toBe(true)

    act(() => {
      hook.result.current.invalidatePending()
    })
    expect(hook.result.current.pendingConfirm).toBeNull()
    expect(hook.result.current.isJoining).toBe(false)

    resolveJoin()
    await act(async () => await confirmPromise)
    // Late IPC completion for the invalidated session must not resurrect state.
    expect(hook.result.current.pendingConfirm).toBeNull()
  })
})
