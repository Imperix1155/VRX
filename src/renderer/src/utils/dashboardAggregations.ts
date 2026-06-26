/**
 * Pure aggregation helpers for the §9 Dashboard view (VRX-169).
 *
 * These functions work on an array of Friend objects from both platforms.
 * No React, no i18n — pure TS so they're unit-testable in plain Vitest.
 */
import type { Friend, InstanceInfo, Platform } from '@shared/types'

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  /** Friends whose presence.state is 'active' or 'in-game' (= online). */
  onlineCount: number
  /** Friends whose presence.state is 'in-game'. */
  inGameCount: number
  /** Number of distinct worlds that appear in hot instances. */
  hotCount: number
}

/**
 * Derives the three stat-card numbers from a merged friends list.
 * `hotCount` depends on `getHotInstances` so callers can pass the already-
 * computed list (avoids a second groupBy pass).
 */
export function getDashboardStats(friends: Friend[], hotInstancesCount: number): DashboardStats {
  let onlineCount = 0
  let inGameCount = 0

  for (const f of friends) {
    const state = f.presence.state
    if (state === 'active' || state === 'in-game') onlineCount++
    if (state === 'in-game') inGameCount++
  }

  return { onlineCount, inGameCount, hotCount: hotInstancesCount }
}

// ─── Hot instances ────────────────────────────────────────────────────────────

/** One "hot world" — the instance info + the count of friends there. */
export interface HotInstance {
  worldId: string
  worldName: string | null
  /** Platform-true instance type from the first representative friend. */
  instanceType: InstanceInfo['type']
  platform: Platform
  friendCount: number
}

const MAX_HOT_INSTANCES = 6

/**
 * Groups online friends by worldId and returns the top worlds sorted by
 * friend count (desc), with a stable tiebreak on worldName then worldId.
 *
 * - Only friends with a non-null instance are included (active/Ask-Me/DND
 *   already have `instance: null` so they're excluded automatically).
 * - Capped at MAX_HOT_INSTANCES (6) — one grid row of cards.
 */
export function getHotInstances(friends: Friend[]): HotInstance[] {
  const map = new Map<string, HotInstance>()

  for (const f of friends) {
    if (f.instance == null) continue

    const { worldId, worldName, type } = f.instance
    const existing = map.get(worldId)
    if (existing) {
      existing.friendCount++
    } else {
      map.set(worldId, {
        worldId,
        worldName,
        instanceType: type,
        platform: f.platform,
        friendCount: 1
      })
    }
  }

  return (
    [...map.values()]
      // A "hot" instance needs 2+ friends — a single friend in a world isn't hot (owner rule).
      .filter((h) => h.friendCount >= 2)
      .sort((a, b) => {
        // Primary: descending friend count
        if (b.friendCount !== a.friendCount) return b.friendCount - a.friendCount
        // Tiebreak 1: worldName lexicographic (nulls last)
        const aName = a.worldName ?? '￿'
        const bName = b.worldName ?? '￿'
        if (aName !== bName) return aName < bName ? -1 : 1
        // Tiebreak 2: worldId (always defined, guarantees full determinism)
        return a.worldId < b.worldId ? -1 : 1
      })
      .slice(0, MAX_HOT_INSTANCES)
  )
}
