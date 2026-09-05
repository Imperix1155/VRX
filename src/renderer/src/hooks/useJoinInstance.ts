import { useSyncExternalStore } from 'react'
import type { InstanceActionResult } from '@shared/ipc'
import type { Friend, JoinMode, JoinModePreference, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { useSettingsStore } from '../stores/settings'
import { queryClient } from '../queries/queryClient'
import { friendsQueryKey } from '../queries/friends'

export type JoinFailureReason = Exclude<InstanceActionResult, { ok: true }>['reason'] | 'unknown'

/**
 * Resolve the wire launch mode when NO dialog picker is involved (VRX-210).
 * VRChat's `vrchat://launch` URI carries no mode selector (verified against
 * VRChat's launch-options docs + VRCX source), so main ignores the value —
 * 'desktop' is a placeholder there. For CVR, an explicit 'vr'/'desktop'
 * preference passes through; 'ask' with the confirmation dialog OFF cannot be
 * honored (there is no one to ask), so it falls back to 'desktop' — the
 * pre-VRX-210 behavior.
 */
export function resolveWireMode(
  friend: { platform: Platform },
  preference: JoinModePreference
): JoinMode {
  if (friend.platform === 'chilloutvr' && preference !== 'ask') return preference
  return 'desktop'
}

export function joinFailureMessageKey(reason: JoinFailureReason): string {
  if (reason === 'stale') return 'friends.joinFailure.stale'
  if (reason === 'cooldown') return 'friends.joinFailure.cooldown'
  if (reason === 'rate-limited') return 'friends.joinFailure.rateLimited'
  if (reason === 'target-changed') return 'friends.joinFailure.targetChanged'
  if (reason === 'joining-disabled') return 'friends.joinFailure.joiningDisabled'
  return 'friends.joinFailed'
}

/** The composite key both platforms can't collide on (same shape as the
 *  row/list keys — an id alone could collide across platforms). */
function friendJoinKey(friend: { platform: Platform; platformUserId: string }): string {
  return `${friend.platform}:${friend.platformUserId}`
}

/** A hot-instance identity the user has SEEN and accepted. */
export interface JoinTarget {
  key: string
  worldId: string
  instanceId: string
}

/** The dialog's pending confirmation state. Reset only on join success, cancel,
 *  or an ordinary terminal failure — preserved across drift/unavailable so the
 *  user can review or wait for the cache to catch up (VRX-239/241). */
export interface PendingConfirm {
  /** Increments per dialog OPEN; keyed for per-open UI reset, never friend
   *  object identity. */
  requestId: number
  platform: Platform
  platformUserId: string
  /** Fallback copy when the live friend disappears. */
  displayName: string
  /** The instance the user reviewed and accepted. */
  reviewedTarget: JoinTarget
  /** When main returns `target-changed`, the `dataUpdatedAt` watermark we must
   *  wait to exceed before another Confirm can proceed. */
  awaitingCacheAfter: number | null
}

export type ConfirmPendingResult = 'joined' | 'review-required' | 'unavailable' | 'failed'

interface JoinSnapshot {
  /** True while ANY surface's join is in flight. */
  joining: boolean
  /** The reviewed target awaiting confirmation in the join dialog (VRX-210).
   *  Null = no dialog. */
  pendingConfirm: PendingConfirm | null
  /** The composite key of the friend whose join was denied — the blip is
   *  ATTRIBUTABLE (Codex re-review): only surfaces showing THAT friend blip,
   *  never every joinable pill. Null = no blip. */
  failedFriendId: string | null
  /** Typed main-process denial retained so callers can render honest copy. */
  failureReason: JoinFailureReason | null
}

interface JoinStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => JoinSnapshot
  join: (friend: Friend) => Promise<void>
  confirmPending: (mode: JoinMode) => Promise<ConfirmPendingResult>
  acknowledgePendingTarget: (presentedKey?: string) => boolean
  cancelPending: () => void
  invalidatePending: () => void
}

/** Read the latest friends array and the query's dataUpdatedAt watermark for CAS. */
function readFriendsCache(platform: Platform): {
  friends: Friend[] | undefined
  dataUpdatedAt: number
  queryError: Error | null
} {
  const state = queryClient.getQueryState<Friend[], Error>(friendsQueryKey(platform))
  return {
    friends: queryClient.getQueryData<Friend[]>(friendsQueryKey(platform)),
    dataUpdatedAt: state?.dataUpdatedAt ?? 0,
    queryError: state?.error ?? null
  }
}

/** Build the JoinTarget the user is seeing for a live friend. */
function targetFor(friend: Friend): JoinTarget | null {
  if (!friend.instance) return null
  const key = hotInstanceKey(friend.platform, friend.instance.instanceId, friend.instance.worldId)
  if (key === null) return null
  return { key, worldId: friend.instance.worldId, instanceId: friend.instance.instanceId }
}

/**
 * A tiny module-level external store (no new dependencies — consumed via
 * `useSyncExternalStore`). Kimi re-review fix, VRX-69: with per-hook state,
 * OTHER Join buttons looked enabled during a join and their clicks silently
 * no-op'd against the latch, and a blip on one surface survived a success on
 * another. One snapshot means every Join surface disables together and one
 * blip state rules — attributed to the friend that failed. The factory
 * exists so the singleton below is the ONLY instance — a per-hook store
 * would resurrect the split-state bug.
 */
function createJoinStore(): JoinStore {
  let requestId = 0
  /** Monotonic session generation. Advances on every new dialog session and on
   *  explicit invalidation (boundary/unmount). In-flight completions must check
   *  their captured generation before mutating state. */
  let sessionGeneration = 0
  let snapshot: JoinSnapshot = {
    joining: false,
    pendingConfirm: null,
    failedFriendId: null,
    failureReason: null
  }
  const listeners = new Set<() => void>()
  let failureTimer: number | null = null

  function emit(patch: Partial<JoinSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  function clearFailureBlip(): void {
    if (failureTimer != null) {
      window.clearTimeout(failureTimer)
      failureTimer = null
    }
    if (snapshot.failedFriendId != null || snapshot.failureReason != null) {
      emit({ failedFriendId: null, failureReason: null })
    }
  }

  function showFailureBlip(friendKey: string, reason: JoinFailureReason): void {
    if (failureTimer != null) window.clearTimeout(failureTimer)
    emit({ failedFriendId: friendKey, failureReason: reason })
    failureTimer = window.setTimeout(() => {
      failureTimer = null
      emit({ failedFriendId: null, failureReason: null })
    }, 2_500)
  }

  async function performJoin(friend: Friend, mode: JoinMode): Promise<void> {
    emit({ joining: true })
    // A new attempt clears any lingering blip immediately (whoever it was for).
    clearFailureBlip()
    const friendKey = friendJoinKey(friend)
    const target = targetFor(friend)
    try {
      // Guard the preload bridge explicitly — it is undefined in Preview and
      // tests (house rule), and a missing bridge is user-equivalent to a denial.
      if (!window.vrx) {
        showFailureBlip(friendKey, 'unknown')
        return
      }
      if (target === null) {
        showFailureBlip(friendKey, 'not-joinable')
        return
      }
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode,
        expectedTarget: { worldId: target.worldId, instanceId: target.instanceId }
      })
      if (result.ok) clearFailureBlip()
      else showFailureBlip(friendKey, result.reason)
    } catch {
      // Bridge exceptions are user-equivalent to a denial: blip, never an
      // unhandled rejection.
      showFailureBlip(friendKey, 'unknown')
    } finally {
      emit({ joining: false })
    }
  }

  async function join(friend: Friend): Promise<void> {
    // The snapshot IS the cross-surface latch: one active join blocks all.
    if (snapshot.joining) return
    // The confirmation dialog is MODAL: while one is parked, a join request
    // (for ANY friend) must not silently swap or stack — ignore it.
    if (snapshot.pendingConfirm !== null) return
    // VRX-210: the confirmation gate lives HERE, in the ONE shared flow, so
    // every join path — the row pill, the drawer button, and the hot-instance
    // card Join (VRX-237) — is intercepted identically. `confirmJoin: false`
    // keeps one-click joining.
    const { allowJoinInstances, confirmJoin, joinMode } = useSettingsStore.getState().settings
    if (!allowJoinInstances) {
      clearFailureBlip()
      showFailureBlip(friendJoinKey(friend), 'joining-disabled')
      return
    }
    if (confirmJoin) {
      // Opening the dialog is a new attempt too: clear any lingering blip.
      clearFailureBlip()
      if (!isFriendJoinable(friend)) {
        showFailureBlip(friendJoinKey(friend), 'not-joinable')
        return
      }
      const target = targetFor(friend)
      if (target === null) return
      requestId += 1
      sessionGeneration += 1
      emit({
        pendingConfirm: {
          requestId,
          platform: friend.platform,
          platformUserId: friend.platformUserId,
          displayName: friend.displayName,
          reviewedTarget: target,
          awaitingCacheAfter: null
        }
      })
      return
    }
    await performJoin(friend, resolveWireMode(friend, joinMode))
  }

  async function confirmPending(mode: JoinMode): Promise<ConfirmPendingResult> {
    const pc = snapshot.pendingConfirm
    // The latch applies to confirmed joins as well: Confirm fires exactly once.
    // If the dialog state is gone or a launch is already running, there is no
    // actionable target available.
    if (pc === null || snapshot.joining) return 'unavailable'

    // Renderer preflight (VRX-239): re-read the TanStack cache synchronously —
    // NEVER the render closure. Fail closed to 'review-required' (drift) or
    // 'unavailable' without calling main.
    const { friends, dataUpdatedAt, queryError } = readFriendsCache(pc.platform)
    if (queryError !== null || friends === undefined) return 'unavailable'
    const live = friends.find((f) => f.platformUserId === pc.platformUserId)
    if (!live) return 'unavailable'
    if (!isFriendJoinable(live)) return 'unavailable'
    const liveTarget = targetFor(live)
    if (liveTarget === null) return 'unavailable'
    if (liveTarget.key !== pc.reviewedTarget.key) return 'review-required'
    if (pc.awaitingCacheAfter !== null && dataUpdatedAt <= pc.awaitingCacheAfter) {
      return 'review-required'
    }

    emit({ joining: true })
    clearFailureBlip()
    const generationAtStart = sessionGeneration
    const friendKey = friendJoinKey(pc)
    try {
      if (!window.vrx) {
        // The session may have been invalidated while we were not awaiting; do
        // not resurrect UI state for a dead session.
        if (generationAtStart !== sessionGeneration) return 'failed'
        showFailureBlip(friendKey, 'unknown')
        emit({ joining: false, pendingConfirm: null })
        return 'failed'
      }
      const result = await window.vrx.joinInstance({
        platform: pc.platform,
        friendId: pc.platformUserId,
        mode,
        expectedTarget: {
          worldId: pc.reviewedTarget.worldId,
          instanceId: pc.reviewedTarget.instanceId
        }
      })
      // The dialog session may have been invalidated (identity boundary, auth
      // invalidated, unmount) while the IPC was in flight. Do not resurrect
      // state for a stale session.
      if (generationAtStart !== sessionGeneration) return 'failed'
      if (result.ok) {
        // Atomic success: focus restoration can happen, joining ends, dialog closes.
        emit({ joining: false, pendingConfirm: null })
        return 'joined'
      }
      if (result.reason === 'target-changed') {
        // Main's authority is ahead of the renderer cache. Re-read the cache;
        // if it already contains a healthy, DIFFERENT target, enter Review
        // immediately so the dialog is never stranded waiting for an update
        // that has already landed. Otherwise arm the watermark and wait.
        const after = readFriendsCache(pc.platform)
        const afterLive = after.friends?.find((f) => f.platformUserId === pc.platformUserId)
        const afterTarget = afterLive && isFriendJoinable(afterLive) ? targetFor(afterLive) : null
        if (afterTarget !== null && afterTarget.key !== pc.reviewedTarget.key) {
          emit({
            pendingConfirm: { ...pc, awaitingCacheAfter: null },
            joining: false
          })
          return 'review-required'
        }
        emit({
          pendingConfirm: {
            ...pc,
            awaitingCacheAfter: after.dataUpdatedAt
          },
          joining: false
        })
        // Main is ahead of the renderer cache; force a single refetch so the
        // wait cannot outlive a 'manual' reconcile cadence.
        void queryClient.refetchQueries({ queryKey: friendsQueryKey(pc.platform) })
        return 'review-required'
      }
      // Ordinary terminal failure: clear the dialog and show the attributed blip.
      showFailureBlip(friendKey, result.reason)
      emit({ joining: false, pendingConfirm: null })
      return 'failed'
    } catch {
      if (generationAtStart !== sessionGeneration) return 'failed'
      showFailureBlip(friendKey, 'unknown')
      emit({ joining: false, pendingConfirm: null })
      return 'failed'
    }
  }

  function acknowledgePendingTarget(presentedKey?: string): boolean {
    const pc = snapshot.pendingConfirm
    if (pc === null || snapshot.joining) return false
    // Acknowledgment must also be healthy: a failed query can retain stale data,
    // and accepting it would let the dialog launch a target the cache can no
    // longer vouch for.
    const { friends, queryError } = readFriendsCache(pc.platform)
    if (queryError !== null || friends === undefined) return false
    const live = friends.find((f) => f.platformUserId === pc.platformUserId)
    if (!live || !isFriendJoinable(live)) return false
    const liveTarget = targetFor(live)
    if (liveTarget === null) return false
    if (presentedKey !== undefined && liveTarget.key !== presentedKey) return false
    emit({
      pendingConfirm: {
        ...pc,
        reviewedTarget: liveTarget,
        awaitingCacheAfter: null
      }
    })
    return true
  }

  function cancelPending(): void {
    // The launch is committed: the modal is inert and Cancel is disabled.
    if (snapshot.joining) return
    if (snapshot.pendingConfirm !== null) {
      sessionGeneration += 1
      emit({ pendingConfirm: null })
    }
  }

  /** Invalidation is stronger than user Cancel: it clears the dialog even while
   *  a launch is settling, and advances the session generation so any late IPC
   *  completion for the old session is ignored. */
  function invalidatePending(): void {
    sessionGeneration += 1
    clearFailureBlip()
    if (snapshot.pendingConfirm !== null || snapshot.joining) {
      emit({ pendingConfirm: null, joining: false })
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    join,
    confirmPending,
    acknowledgePendingTarget,
    cancelPending,
    invalidatePending
  }
}

/** ONE store for the whole renderer — every Join surface shares it. */
const sharedJoinStore = createJoinStore()

/**
 * The ONE join-a-friend flow (VRX-166 row pill · VRX-69 drawer button).
 * All state is GLOBAL via the shared store above: `isJoining` is true on
 * every surface while any join runs (all Join buttons disable together — no
 * enabled-looking button whose click silently no-ops), and the one 2.5s
 * failure blip is ATTRIBUTED to the friend that failed. `joinFailureFor`
 * retains the typed denial for honest copy, while `joinFailedFor` remains the
 * boolean convenience API. Both clear at the start of a new attempt and on
 * success, wherever it fires. Callers own event concerns.
 *
 * VRX-210: with `settings.confirmJoin` on, `join` does NOT launch — it parks
 * the reviewed target in `pendingConfirm` and the `JoinConfirmDialog` (mounted
 * once in AppShell) owns the choice: `confirmPending(mode)` fires exactly one
 * join, `cancelPending()` fires nothing. With the setting off, `join` launches
 * immediately, resolving the wire mode from `settings.joinMode`.
 *
 * VRX-239/241: the dialog renders from the LIVE friend looked up in the
 * TanStack cache. If the live target drifts from the reviewed target, the
 * dialog enters a DRIFT state (Confirm disabled, Review action) and never
 * silently launches the old target. If the live friend becomes unavailable,
 * the dialog enters an UNAVAILABLE state (Cancel only). Confirm performs a
 * synchronous cache preflight before invoking main, and main compares the
 * renderer's expected target against its authoritative current target.
 */
export function useJoinInstance(): {
  isJoining: boolean
  pendingConfirm: PendingConfirm | null
  joinFailedFor: (friend: Friend) => boolean
  joinFailureFor: (friend: Pick<Friend, 'platform' | 'platformUserId'>) => JoinFailureReason | null
  join: (friend: Friend) => Promise<void>
  confirmPending: (mode: JoinMode) => Promise<ConfirmPendingResult>
  acknowledgePendingTarget: (presentedKey?: string) => boolean
  cancelPending: () => void
  invalidatePending: () => void
} {
  const { joining, pendingConfirm, failedFriendId, failureReason } = useSyncExternalStore(
    sharedJoinStore.subscribe,
    sharedJoinStore.getSnapshot,
    // Server snapshot: the SSR-rendered markup tests (renderToStaticMarkup)
    // read the same module snapshot — no window access happens on read.
    sharedJoinStore.getSnapshot
  )
  return {
    isJoining: joining,
    pendingConfirm,
    joinFailedFor: (friend) => failedFriendId === friendJoinKey(friend),
    joinFailureFor: (friend) => (failedFriendId === friendJoinKey(friend) ? failureReason : null),
    join: sharedJoinStore.join,
    confirmPending: sharedJoinStore.confirmPending,
    acknowledgePendingTarget: sharedJoinStore.acknowledgePendingTarget,
    cancelPending: sharedJoinStore.cancelPending,
    invalidatePending: sharedJoinStore.invalidatePending
  }
}
