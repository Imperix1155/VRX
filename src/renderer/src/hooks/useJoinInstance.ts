import { useSyncExternalStore } from 'react'
import type { Friend } from '@shared/types'

interface JoinSnapshot {
  /** True while ANY surface's join is in flight. */
  joining: boolean
  /** Non-null while the failure blip is showing (the last denial's timestamp). */
  failedAt: number | null
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
 * blip state rules. The factory exists so the singleton below is the ONLY
 * instance — a per-hook store would resurrect the split-state bug.
 */
function createJoinStore(): JoinStore {
  let snapshot: JoinSnapshot = { joining: false, failedAt: null }
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
    if (snapshot.failedAt != null) emit({ failedAt: null })
  }

  function showFailureBlip(): void {
    if (failureTimer != null) window.clearTimeout(failureTimer)
    emit({ failedAt: Date.now() })
    failureTimer = window.setTimeout(() => {
      failureTimer = null
      emit({ failedAt: null })
    }, 2_500)
  }

  async function join(friend: Friend): Promise<void> {
    // The snapshot IS the cross-surface latch: one active join blocks all.
    if (snapshot.joining) return
    emit({ joining: true })
    // A new attempt clears any lingering blip immediately.
    clearFailureBlip()
    try {
      // Guard the preload bridge explicitly — it is undefined in Preview and
      // tests (house rule), and a missing bridge is user-equivalent to a denial.
      if (!window.vrx) {
        showFailureBlip()
        return
      }
      // VRChat ignores mode; a CVR VR-mode picker is a future setting.
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode: 'desktop'
      })
      if (result.ok) clearFailureBlip()
      else showFailureBlip()
    } catch {
      // Bridge exceptions are user-equivalent to a denial: blip, never an
      // unhandled rejection.
      showFailureBlip()
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
 * enabled-looking button whose click silently no-ops), and `joinFailed` is
 * the one 2.5s failure blip — cleared at the start of a new attempt and on
 * success. Same public API as before (`isJoining`, `joinFailed`, `join`).
 * Callers own event concerns (the row stopPropagation's its click).
 */
export function useJoinInstance(): {
  isJoining: boolean
  joinFailed: boolean
  join: (friend: Friend) => Promise<void>
} {
  const { joining, failedAt } = useSyncExternalStore(
    sharedJoinStore.subscribe,
    sharedJoinStore.getSnapshot,
    // Server snapshot: the SSR-rendered markup tests (renderToStaticMarkup)
    // read the same module snapshot — no window access happens on read.
    sharedJoinStore.getSnapshot
  )
  return { isJoining: joining, joinFailed: failedAt != null, join: sharedJoinStore.join }
}
