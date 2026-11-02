import type { ActivityEntry } from '@shared/activity'
import { FRIEND_SECTIONS, type Friend, type FriendSort, type OpennessTier } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { isWorldHidden } from './statusRing'
import type { LinkedRow } from './projectLinkedFriends'

/**
 * Friends list order inside each group (owner, 2026-11-02). Every choice keeps
 * the groups (In-Game, Online, Offline) and falls back to the name, so a row
 * never jumps between groups and two friends with the same key keep a fixed
 * order. Nothing here reads a platform: Recent uses the Activity list VRX
 * already keeps, World and Joinable use the presence each row already has.
 */

const SECTION_ORDER = new Map(FRIEND_SECTIONS.map((section, index) => [section, index]))

/** Most open first; matches the instance pill ladder (DESIGN.md §6). */
const OPENNESS_RANK: Record<OpennessTier, number> = {
  public: 0,
  'friends-plus': 1,
  friends: 2,
  'invite-plus': 3,
  invite: 4,
  offline: 5
}

const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base' })

function friendKey(platform: Friend['platform'], platformUserId: string): string {
  return `${platform}\u0000${platformUserId}`
}

/** Newest Activity time per friend. The list is newest first. */
export function latestActivityByFriend(
  entries: readonly ActivityEntry[] | undefined
): Map<string, number> {
  const latest = new Map<string, number>()
  for (const entry of entries ?? []) {
    const key = friendKey(entry.platform, entry.platformUserId)
    const current = latest.get(key)
    if (current === undefined || entry.at > current) latest.set(key, entry.at)
  }
  return latest
}

interface ShownInstance {
  /** The shared instance identity (`hotInstanceKey`), namespaced by platform. */
  key: string
  worldName: string
}

/** The shown instance a row is in, or null when it is in none we can see. */
function visibleInstance(row: LinkedRow): ShownInstance | null {
  for (const account of row.accounts) {
    if (account.presence.state !== 'in-game' || isWorldHidden(account)) continue
    const instance = account.instance
    if (instance === null) continue
    const key = hotInstanceKey(account.platform, instance.instanceId, instance.worldId)
    if (key === null) continue
    return { key: `${account.platform}\u0000${key}`, worldName: instance.worldName ?? '' }
  }
  return null
}

function joinRank(row: LinkedRow): number {
  let best = Number.POSITIVE_INFINITY
  for (const account of row.accounts) {
    if (!isFriendJoinable(account) || account.instance === null) continue
    best = Math.min(best, OPENNESS_RANK[account.instance.openness] ?? 5)
  }
  return best
}

function recentAt(row: LinkedRow, latest: ReadonlyMap<string, number>): number {
  let newest = Number.NEGATIVE_INFINITY
  for (const account of row.accounts) {
    newest = Math.max(
      newest,
      latest.get(friendKey(account.platform, account.platformUserId)) ?? Number.NEGATIVE_INFINITY
    )
  }
  return newest
}

export interface FriendSortContext {
  /** From {@link latestActivityByFriend}; only Recent reads it. */
  latestActivity: ReadonlyMap<string, number>
}

/**
 * The rows in the chosen order, grouped as before. Input rows come from
 * `projectLinkedFriends` (group, then name); Name returns them unchanged.
 */
export function sortFriendRows(
  rows: readonly LinkedRow[],
  sort: FriendSort,
  context: FriendSortContext
): LinkedRow[] {
  if (sort === 'name') return rows as LinkedRow[]
  const position = new Map(rows.map((row, index) => [row, index]))
  // World: friends in the same instance sit together, the biggest crowd first.
  const crowd = new Map<string, number>()
  if (sort === 'world') {
    for (const row of rows) {
      const instance = visibleInstance(row)
      if (instance === null) continue
      crowd.set(instance.key, (crowd.get(instance.key) ?? 0) + 1)
    }
  }
  const compareKey = (left: LinkedRow, right: LinkedRow): number => {
    if (sort === 'recent') {
      const leftAt = recentAt(left, context.latestActivity)
      const rightAt = recentAt(right, context.latestActivity)
      if (leftAt !== rightAt) return rightAt > leftAt ? 1 : -1
      return 0
    }
    if (sort === 'joinable') {
      return joinRank(left) - joinRank(right) || 0
    }
    const leftInstance = visibleInstance(left)
    const rightInstance = visibleInstance(right)
    if (leftInstance === null || rightInstance === null) {
      return (leftInstance === null ? 1 : 0) - (rightInstance === null ? 1 : 0)
    }
    const leftKey = leftInstance.key
    const rightKey = rightInstance.key
    if (leftKey === rightKey) return 0
    const bySize = (crowd.get(rightKey) ?? 0) - (crowd.get(leftKey) ?? 0)
    if (bySize !== 0) return bySize
    const byWorld = nameCollator.compare(leftInstance.worldName, rightInstance.worldName)
    return byWorld !== 0 ? byWorld : leftKey < rightKey ? -1 : 1
  }
  return [...rows].sort((left, right) => {
    const bySection =
      (SECTION_ORDER.get(left.section) ?? 0) - (SECTION_ORDER.get(right.section) ?? 0)
    if (bySection !== 0) return bySection
    const byKey = compareKey(left, right)
    if (byKey !== 0 && !Number.isNaN(byKey)) return byKey
    return (position.get(left) ?? 0) - (position.get(right) ?? 0)
  })
}
