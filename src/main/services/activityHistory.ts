/**
 * The Activity list's saved copy (owner, 2026-11-15). It sits between the
 * in-memory `ActivityFeed` and the history file: it decides whose rows a call
 * may touch (only the account signed in on that platform, resolved by main at
 * the moment of the call) and how long rows stay (the Keep activity for
 * setting). It asks no platform for anything.
 *
 * With the setting on "until VRX closes" it saves nothing and answers `null`
 * for pages, so the feed serves them from memory as it always did.
 */
import {
  ACTIVITY_KEEP_DAYS,
  type ActivityEntry,
  type ActivityKeepFor,
  type ActivityKind,
  type ActivityPageRequest
} from '@shared/activity'
import { ACTIVITY_MAX_SAVED_ROWS } from '@shared/constants'
import type { Platform } from '@shared/types'
import type { ActivityStore } from './activityFeed'
import { toActivityEntry, type HistoryDatabase } from './historyDatabase'

const DAY_MS = 86_400_000

export interface ActivityHistoryOptions {
  database: HistoryDatabase
  /** The signed-in account's key on a platform, or null when none is resolved. */
  accountKeyFor: (platform: Platform) => string | null
  /** Read at each call, like every other setting main acts on. */
  keepFor: () => ActivityKeepFor
  now: () => number
}

export class ActivityHistory implements ActivityStore {
  constructor(private readonly options: ActivityHistoryOptions) {}

  maxId(): number {
    return this.options.database.maxActivityId()
  }

  append(entry: ActivityEntry): void {
    if (!this.isSaving()) return
    const accountKey = this.options.accountKeyFor(entry.platform)
    if (accountKey === null) return
    this.options.database.insertActivity({
      id: entry.id,
      accountKey,
      kind: entry.kind,
      platformUserId: entry.platformUserId,
      displayName: entry.displayName,
      worldName: entry.worldName,
      at: entry.at
    })
  }

  setWorldName(id: number, worldName: string): void {
    if (!this.isSaving()) return
    this.options.database.setActivityWorldName(id, worldName)
  }

  recent(platform: Platform, limit: number): ActivityEntry[] {
    if (!this.isSaving()) return []
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return []
    return toEntries(this.options.database.recentActivity(accountKey, limit))
  }

  page(request: ActivityPageRequest, limit: number): ActivityEntry[] | null {
    if (!this.isSaving()) return null
    const keys = new Map<Platform, string>()
    const accounts: Array<{ accountKey: string; beforeId: number | null }> = []
    for (const cursor of request.scope) {
      if (keys.has(cursor.platform)) continue
      const accountKey = this.options.accountKeyFor(cursor.platform)
      if (accountKey === null) continue
      keys.set(cursor.platform, accountKey)
      accounts.push({ accountKey, beforeId: cursor.beforeId })
    }
    let friends: Array<{ accountKey: string; platformUserId: string }> | null = null
    if (request.friends !== undefined) {
      friends = []
      for (const friend of request.friends) {
        const accountKey = keys.get(friend.platform)
        if (accountKey !== undefined) {
          friends.push({ accountKey, platformUserId: friend.friendId })
        }
      }
    }
    return toEntries(
      this.options.database.pageActivity({
        accounts,
        kind: request.filter === 'all' ? null : request.filter,
        friends,
        limit
      })
    )
  }

  clear(platform: Platform, kind: ActivityKind | null): void {
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return
    this.options.database.deleteActivity(accountKey, kind)
  }

  clearAll(): void {
    this.options.database.deleteAllActivity()
  }

  /** Apply the setting to what is saved: at launch, on a timer, and whenever
   *  the setting changes. "Until VRX closes" removes everything saved. */
  prune(): void {
    const keepFor = this.options.keepFor()
    if (keepFor === 'session') {
      this.options.database.deleteAllActivity()
      return
    }
    const days = ACTIVITY_KEEP_DAYS[keepFor]
    this.options.database.pruneActivity(
      days === null ? null : this.options.now() - days * DAY_MS,
      ACTIVITY_MAX_SAVED_ROWS
    )
  }

  private isSaving(): boolean {
    return this.options.keepFor() !== 'session'
  }
}

function toEntries(rows: ReturnType<HistoryDatabase['recentActivity']>): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  for (const row of rows) {
    const entry = toActivityEntry(row)
    if (entry !== null) entries.push(entry)
  }
  return entries
}
