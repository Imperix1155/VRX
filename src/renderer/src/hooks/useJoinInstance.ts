import { useSyncExternalStore } from 'react'
import type { InstanceActionResult } from '@shared/ipc'
import type { Friend, JoinMode, JoinModePreference } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

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
export function resolveWireMode(friend: Friend, preference: JoinModePreference): JoinMode {
  if (friend.platform === 'chilloutvr' && preference !== 'ask') return preference
  return 'desktop'
}

export function joinFailureMessageKey(reason: JoinFailureReason): string {
  if (reason === 'stale') return 'friends.joinFailure.stale'
  if (reason === 'cooldown') return 'friends.joinFailure.cooldown'
  return 'friends.joinFailed'
}

/** The composite key both platforms can't collide on (same shape as the
 *  row/list keys — an id alone could collide across platforms). */
function friendJoinKey(friend: Friend): string {
  return `${friend.platform}:${friend.platformUserId}`
}

interface JoinSnapshot {
  /** True while ANY surface's join is in flight. */
  joining: boolean
  /** The friend awaiting confirmation in the join dialog (VRX-210). Null = no dialog. */
  pendingConfirm: Friend | null
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
  confirmPending: (mode: JoinMode) => Promise<void>
  cancelPending: () => void
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
    try {
      // Guard the preload bridge explicitly — it is undefined in Preview and
      // tests (house rule), and a missing bridge is user-equivalent to a denial.
      if (!window.vrx) {
        showFailureBlip(friendKey, 'unknown')
        return
      }
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode
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
    // every join path — the row pill, the drawer button, and any future
    // surface (the hot-instance card join is VRX-59's to add) — is
    // intercepted identically. `confirmJoin: false` keeps one-click joining.
    const { confirmJoin, joinMode } = useSettingsStore.getState().settings
    if (confirmJoin) {
      // Opening the dialog is a new attempt too: clear any lingering blip.
      clearFailureBlip()
      emit({ pendingConfirm: friend })
      return
    }
    await performJoin(friend, resolveWireMode(friend, joinMode))
  }

  async function confirmPending(mode: JoinMode): Promise<void> {
    const friend = snapshot.pendingConfirm
    // The latch applies to confirmed joins as well: Confirm fires exactly once.
    if (friend === null || snapshot.joining) return
    emit({ pendingConfirm: null })
    await performJoin(friend, mode)
  }

  function cancelPending(): void {
    if (snapshot.pendingConfirm !== null) emit({ pendingConfirm: null })
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    join,
    confirmPending,
    cancelPending
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
 * the friend in `pendingConfirm` and the `JoinConfirmDialog` (mounted once in
 * AppShell) owns the choice: `confirmPending(mode)` fires exactly one join,
 * `cancelPending()` fires nothing. With the setting off, `join` launches
 * immediately, resolving the wire mode from `settings.joinMode`.
 */
export function useJoinInstance(): {
  isJoining: boolean
  pendingConfirm: Friend | null
  joinFailedFor: (friend: Friend) => boolean
  joinFailureFor: (friend: Friend) => JoinFailureReason | null
  join: (friend: Friend) => Promise<void>
  confirmPending: (mode: JoinMode) => Promise<void>
  cancelPending: () => void
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
    cancelPending: sharedJoinStore.cancelPending
  }
}
