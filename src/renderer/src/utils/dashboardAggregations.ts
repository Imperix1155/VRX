/**
 * Pure aggregation helpers for the §9 Dashboard view (VRX-169).
 *
 * These functions work on an array of Friend objects from both platforms.
 * No React, no i18n — pure TS so they're unit-testable in plain Vitest.
 */
import type { Friend, InstanceInfo, Platform } from '@shared/types'
import { HOT_INSTANCE_THRESHOLD } from '@shared/constants'
import { hotInstanceKey, isHotInstanceMember } from '@shared/hotInstanceKey'

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  /** Friends whose presence.state is 'active' or 'in-game' (= online). */
  onlineCount: number
  /** Friends whose presence.state is 'in-game'. */
  inGameCount: number
  /** Number of distinct hot instances (exact-instance groups ≥ threshold). */
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

/** One hot instance — the exact instance identity + the friends provably inside it. */
export interface HotInstance {
  worldId: string
  worldName: string | null
  /** The exact instance id EVERY member shares (VRX-237). */
  instanceId: string
  /**
   * Platform-true instance type — now truthful automatically: every member is
   * in THIS instance, so the representative's type is the group's type.
   */
  instanceType: InstanceInfo['type']
  /**
   * True when ANY member's privacy value was unrecognized and openness was
   * degraded (VRX-244) — OR'd across members in `getHotInstances` so a
   * transient per-member disagreement (a cache-restored member still
   * degraded while a fresh-roster member resolved cleanly) can only widen
   * toward the honest answer, never narrow past it. Every pill surface
   * renders the honest "Unknown" treatment from this ONE field instead of
   * asserting a degraded fallback type as fact.
   */
  opennessUnknown?: boolean
  /** True for group instances (carried from every member's InstanceInfo). */
  isGroup: boolean
  /** Owning group's display name, when isGroup. */
  groupName: string | null
  /** Owning group's id, when isGroup and the platform exposes it. */
  groupId: string | null
  /** Owning group's image/icon URL, when known. */
  groupImageUrl: string | null
  /** World thumbnail, when known; carried from the shared InstanceInfo. */
  thumbnailUrl: string | null
  platform: Platform
  friendCount: number
  /**
   * Display names of the friends here, sorted alphabetically for a stable order
   * (VRX-198). Derived from `members` (same order); the card shows the first few
   * then "+N". (Favorites-first ordering is a future nicety once favorites wire up.)
   */
  friendNames: string[]
  /**
   * The member friends themselves, sorted alphabetically by displayName
   * (VRX-237) — the card's Join affordance routes through the first JOINABLE
   * member; any member works because they provably share the instance.
   */
  members: Friend[]
  /** The composite group identity (platform + shared hotInstanceKey) — the deterministic tiebreak and the React key. */
  groupKey: string
}

const MAX_HOT_INSTANCES = 6

/**
 * Groups friends by EXACT INSTANCE and returns the top instances sorted by
 * friend count (desc), with stable tiebreaks on worldName then the composite
 * group key.
 *
 * - Grouping by EXACT INSTANCE (platform + shared `hotInstanceKey` — VRChat
 *   `[worldId, instanceId]`, CVR instance id) is THE LAW (owner, 2026-08-01,
 *   VRX-237): a hot instance is multiple friends in the SAME instance — exact
 *   instanceId equality, never same-world, never same-type. The old worldId
 *   grouping manufactured a false social signal (it implied friends were
 *   hanging out together who were in different instances of one world). This
 *   SUPERSEDES the audit W5 disposition ("keep worldId, do not switch to
 *   instanceId") and the stale DESIGN.md §6.1 "same world" citation that
 *   stood here. The key shape is shared with the main-process alert engine
 *   (`FriendAlerts`) via `@shared/hotInstanceKey` so the toast and the cards
 *   can never disagree about what "the same instance" means.
 * - Membership is the shared `isHotInstanceMember` predicate (VRX-237 — the
 *   SAME predicate the alert engine uses, so toast and cards count the same
 *   people): `state === 'in-game'` AND `instance` non-null AND NOT
 *   hidden-location. The state gate matters — a swallowed /auth/user bucket
 *   read can leave every friend 'offline' with a stale populated `instance`;
 *   that must never render a hot card of "offline" friends. The privacy half
 *   is the owner law (2026-08-01): Ask Me / DND friends are INVISIBLE to the
 *   whole hot system — they never count toward the threshold, never appear
 *   in members/names/aria, never contribute world/openness. A card exists
 *   iff VISIBLE members alone ≥ threshold.
 * - Members are deduped by `platform:platformUserId` (first occurrence
 *   wins) — a duplicated row must never count one person twice.
 * - Capped at MAX_HOT_INSTANCES (6) — one grid row of cards.
 * - `threshold` is the user's `settings.hotInstanceThreshold` (VRX-78);
 *   defaults to the project constant so non-UI callers stay unchanged.
 */
export function getHotInstances(
  friends: Friend[],
  threshold: number = HOT_INSTANCE_THRESHOLD
): HotInstance[] {
  const map = new Map<string, HotInstance>()
  // Dedupe by identity (first occurrence wins): a duplicated normalized
  // friend row (a paginated fetch shifting mid-run is a real producer) must
  // never count ONE person twice — that would fabricate the exact false
  // togetherness VRX-237 exists to kill. The alert engine keys by
  // platformUserId; the dashboard now agrees.
  const seen = new Set<string>()

  for (const f of friends) {
    // THE shared membership predicate (VRX-237) — see the docblock above.
    if (!isHotInstanceMember(f)) continue
    const identity = `${f.platform}:${f.platformUserId}`
    if (seen.has(identity)) continue
    seen.add(identity)

    const instance = f.instance
    if (instance === null) continue
    const { worldId, worldName, type, instanceId } = instance
    const key = hotInstanceKey(f.platform, instanceId, worldId)
    if (key === null) continue
    // The shared key is platform-relative (the alert engine namespaces via
    // per-platform maps); the dashboard merges both platforms into one list,
    // so it prefixes the platform — cross-platform collision is impossible.
    const groupKey = `${f.platform} ${key}`
    const existing = map.get(groupKey)
    if (existing) {
      existing.friendCount++
      existing.members.push(f)
      // Members of the SAME exact instance can transiently disagree on
      // opennessUnknown too (e.g. a cache-restored member still carries the
      // degraded flag while a fresh-roster member for the same instance
      // resolved cleanly). OR across members — any member unknown makes the
      // whole card's privacy claim unknown — so the flag can only ever widen
      // toward the safe/honest answer, matching the defensive-understatement
      // philosophy `parseCvrPrivacy` already applies per-member (VRX-244).
      if (instance.opennessUnknown === true) existing.opennessUnknown = true
      // Members of the SAME exact instance can transiently disagree on group
      // metadata (e.g. after hydration the merge filled one member but a
      // fresh-roster member is still null). Back-fill nulls from any member
      // that knows more — same groupId only, never across (CodeRabbit, VRX-260).
      if (existing.isGroup && existing.groupId !== null && instance.groupId === existing.groupId) {
        if (existing.groupName === null && instance.groupName !== null) {
          existing.groupName = instance.groupName
        }
        if (existing.groupImageUrl === null && instance.groupImageUrl !== null) {
          existing.groupImageUrl = instance.groupImageUrl
        }
      }
    } else {
      map.set(groupKey, {
        worldId,
        worldName,
        instanceId,
        instanceType: type,
        opennessUnknown: instance.opennessUnknown,
        isGroup: instance.isGroup,
        groupName: instance.groupName,
        groupId: instance.groupId,
        groupImageUrl: instance.groupImageUrl,
        thumbnailUrl: instance.thumbnailUrl,
        platform: f.platform,
        friendCount: 1,
        friendNames: [],
        members: [f],
        groupKey
      })
    }
  }

  // Stable alphabetical member order so the "first few + N" and the card Join's
  // deterministic target are stable; friendNames derives from the ONE sort.
  for (const h of map.values()) {
    h.members.sort((a, b) => a.displayName.localeCompare(b.displayName))
    h.friendNames = h.members.map((m) => m.displayName)
  }

  return (
    [...map.values()]
      // A "hot" instance needs `threshold`+ friends IN THE SAME INSTANCE
      // (user-configurable, VRX-78; the 2+ default is the owner rule — a
      // single friend in an instance isn't hot).
      .filter((h) => h.friendCount >= threshold)
      .sort((a, b) => {
        // Primary: descending friend count
        if (b.friendCount !== a.friendCount) return b.friendCount - a.friendCount
        // Tiebreak 1: worldName lexicographic (nulls last)
        const aName = a.worldName ?? '￿'
        const bName = b.worldName ?? '￿'
        if (aName !== bName) return aName < bName ? -1 : 1
        // Tiebreak 2: the composite group key (always defined, guarantees
        // full determinism — two hot instances can share world + name).
        if (a.groupKey !== b.groupKey) return a.groupKey < b.groupKey ? -1 : 1
        return 0
      })
      .slice(0, MAX_HOT_INSTANCES)
  )
}
