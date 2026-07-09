/**
 * Pure aggregation helpers for the §9 Dashboard view (VRX-169).
 *
 * These functions work on an array of Friend objects from both platforms.
 * No React, no i18n — pure TS so they're unit-testable in plain Vitest.
 */
import type { Friend, InstanceInfo, Platform } from '@shared/types'
import { HOT_INSTANCE_THRESHOLD } from '@shared/constants'

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
  /**
   * Display names of the friends here, sorted alphabetically for a stable order
   * (VRX-198). `friendNames.length === friendCount`; the card shows the first few
   * then "+N". (Favorites-first ordering is a future nicety once favorites wire up.)
   */
  friendNames: string[]
}

const MAX_HOT_INSTANCES = 6

/**
 * Groups online friends by worldId and returns the top worlds sorted by
 * friend count (desc), with a stable tiebreak on worldName then worldId.
 *
 * - Grouping by WORLD (not instance) is intentional — DESIGN.md §6.1 and the
 *   owner copy define hot as friends "gather[ing] in the same world"; two
 *   friends in different instances of one world still count (audit W5
 *   disposition: keep worldId, do not switch to instanceId).
 * - Only friends with a non-null instance are included (active/Ask-Me/DND
 *   already have `instance: null` so they're excluded automatically).
 * - Capped at MAX_HOT_INSTANCES (6) — one grid row of cards.
 * - `threshold` is the user's `settings.hotInstanceThreshold` (VRX-78);
 *   defaults to the project constant so non-UI callers stay unchanged.
 */
export function getHotInstances(
  friends: Friend[],
  threshold: number = HOT_INSTANCE_THRESHOLD
): HotInstance[] {
  const map = new Map<string, HotInstance>()

  for (const f of friends) {
    if (f.instance == null) continue

    const { worldId, worldName, type } = f.instance
    const existing = map.get(worldId)
    if (existing) {
      existing.friendCount++
      existing.friendNames.push(f.displayName)
    } else {
      map.set(worldId, {
        worldId,
        worldName,
        instanceType: type,
        platform: f.platform,
        friendCount: 1,
        friendNames: [f.displayName]
      })
    }
  }

  // Stable alphabetical order per world so the "first few + N" is deterministic.
  for (const h of map.values()) h.friendNames.sort((a, b) => a.localeCompare(b))

  return (
    [...map.values()]
      // A "hot" instance needs `threshold`+ friends (user-configurable, VRX-78;
      // the 2+ default is the owner rule — a single friend in a world isn't hot).
      .filter((h) => h.friendCount >= threshold)
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
