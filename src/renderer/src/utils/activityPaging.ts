/**
 * Paging helpers for saved activity (owner, 2026-11-15). Pure: the Activity
 * page and a friend's History both use them to decide where the next older
 * page starts on each platform.
 */
import type { ActivityEntry, ActivityPageCursor } from '@shared/activity'
import type { Platform } from '@shared/types'

/**
 * Where "older than the list" starts. Main keeps the newest `cap` entries per
 * platform in the list and tops it back up from the saved copy, so a platform
 * with fewer than `cap` there has nothing older saved and is left out. A
 * platform at `cap` continues below its oldest listed entry.
 */
export function olderThanList(
  live: readonly ActivityEntry[],
  platforms: readonly Platform[],
  cap: number
): ActivityPageCursor[] {
  const cursors: ActivityPageCursor[] = []
  for (const platform of platforms) {
    let count = 0
    let oldest = Infinity
    for (const entry of live) {
      if (entry.platform !== platform) continue
      count += 1
      if (entry.id < oldest) oldest = entry.id
    }
    if (count >= cap && Number.isFinite(oldest)) cursors.push({ platform, beforeId: oldest })
  }
  return cursors
}

/** After a page: each platform continues below its own oldest entry in it. A
 *  platform with nothing in the page keeps its place. */
export function advanceCursors(
  cursors: readonly ActivityPageCursor[],
  page: readonly ActivityEntry[]
): ActivityPageCursor[] {
  return cursors.map((cursor) => {
    let oldest = Infinity
    for (const entry of page) {
      if (entry.platform === cursor.platform && entry.id < oldest) oldest = entry.id
    }
    return Number.isFinite(oldest) ? { platform: cursor.platform, beforeId: oldest } : cursor
  })
}

/** One list from several sources, newest first, each entry once. Later
 *  sources win, so pass the freshest copy (the live list) last. */
export function mergeActivity(...sources: ReadonlyArray<Iterable<ActivityEntry>>): ActivityEntry[] {
  const byId = new Map<number, ActivityEntry>()
  for (const source of sources) {
    for (const entry of source) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => b.id - a.id)
}
