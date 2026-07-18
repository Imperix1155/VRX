import { useSyncExternalStore } from 'react'
import type { Friend } from '@shared/types'

/** The composite key both platforms can't collide on (same shape as the
 *  row/list keys — an id alone could collide across platforms). */
function friendJoinKey(friend: Friend): string {
  return `${friend.platform}:${friend.platformUserId}`
}

interface JoinSnapshot {
  /** True while ANY surface's join is in flight. */
  joining: boolean
  /** The composite key of the friend whose join was denied — the blip is
   *  ATTRIBUTABLE (Codex re-review): only surfaces showing THAT friend blip,
   *  never every joinable pill. Null = no blip. */
  failedFriendId: string | null
}

interface JoinStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => JoinSnapshot
  join: (friend: Friend) => Promise<void>
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
  let snapshot: JoinSnapshot = { joining: false, failedFriendId: null }
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
    if (snapshot.failedFriendId != null) emit({ failedFriendId: null })
  }

  function showFailureBlip(friendKey: string): void {
    if (failureTimer != null) window.clearTimeout(failureTimer)
    emit({ failedFriendId: friendKey })
    failureTimer = window.setTimeout(() => {
      failureTimer = null
      emit({ failedFriendId: null })
    }, 2_500)
  }

  async function join(friend: Friend): Promise<void> {
    // The snapshot IS the cross-surface latch: one active join blocks all.
    if (snapshot.joining) return
    emit({ joining: true })
    // A new attempt clears any lingering blip immediately (whoever it was for).
    clearFailureBlip()
    const friendKey = friendJoinKey(friend)
    try {
      // Guard the preload bridge explicitly — it is undefined in Preview and
      // tests (house rule), and a missing bridge is user-equivalent to a denial.
      if (!window.vrx) {
        showFailureBlip(friendKey)
        return
      }
      // VRChat ignores mode; a CVR VR-mode picker is a future setting.
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode: 'desktop'
      })
      if (result.ok) clearFailureBlip()
      else showFailureBlip(friendKey)
    } catch {
      // Bridge exceptions are user-equivalent to a denial: blip, never an
      // unhandled rejection.
      showFailureBlip(friendKey)
    } finally {
      emit({ joining: false })
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    join
  }
}

/** ONE store for the whole renderer — every Join surface shares it. */
const sharedJoinStore = createJoinStore()

/**
 * The ONE join-a-friend flow (VRX-166 row pill · VRX-69 drawer button).
 * All state is GLOBAL via the shared store above: `isJoining` is true on
 * every surface while any join runs (all Join buttons disable together — no
 * enabled-looking button whose click silently no-ops), and the one 2.5s
 * failure blip is ATTRIBUTED to the friend that failed — callers show it via
 * `joinFailedFor(friend)`, so only that friend's pill/drawer blips (cleared
 * at the start of a new attempt and on success, wherever it fires). Callers
 * own event concerns (the row stopPropagation's its click).
 */
export function useJoinInstance(): {
  isJoining: boolean
  joinFailedFor: (friend: Friend) => boolean
  join: (friend: Friend) => Promise<void>
} {
  const { joining, failedFriendId } = useSyncExternalStore(
    sharedJoinStore.subscribe,
    sharedJoinStore.getSnapshot,
    // Server snapshot: the SSR-rendered markup tests (renderToStaticMarkup)
    // read the same module snapshot — no window access happens on read.
    sharedJoinStore.getSnapshot
  )
  return {
    isJoining: joining,
    joinFailedFor: (friend) => failedFriendId === friendJoinKey(friend),
    join: sharedJoinStore.join
  }
}
