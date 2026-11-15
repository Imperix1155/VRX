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
  activityKindsOf,
  type ActivityEntry,
  type ActivityKeepFor,
  type ActivityKind,
  type ActivityPageRequest
} from '@shared/activity'
import { ACTIVITY_MAX_SAVED_ROWS, INSTANCE_LOG_MAX_SAVED_VISITS } from '@shared/constants'
import type { Platform } from '@shared/types'
import type { ActivityStore } from './activityFeed'
import type { FriendLogStore } from './friendLog'
import {
  toActivityEntry,
  type HistoryDatabase,
  type SavedFriend,
  type SavedNameChange
} from './historyDatabase'

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
      previousName: entry.previousName ?? null,
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
        kinds: activityKindsOf(request.filter),
        friends,
        limit
      })
    )
  }

  clear(platform: Platform, kinds: readonly ActivityKind[] | null): void {
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return
    this.options.database.deleteActivity(accountKey, kinds)
  }

  clearAll(): void {
    this.options.database.deleteAllActivity()
  }

  /** Apply the setting to what is saved: at launch, on a timer, and whenever
   *  the setting changes. "Until VRX closes" removes everything saved. */
  prune(): void {
    const keepFor = this.options.keepFor()
    const database = this.options.database
    if (keepFor === 'session') {
      database.deleteAllActivity()
      database.deleteAllInstanceLog()
      return
    }
    const olderThan = this.cutoff()
    database.pruneActivity(olderThan, ACTIVITY_MAX_SAVED_ROWS)
    // The instance log follows the same choice.
    database.pruneInstanceLog(olderThan, INSTANCE_LOG_MAX_SAVED_VISITS)
  }

  /** The oldest moment the setting still keeps, or null when nothing is
   *  removed by age. */
  cutoff(): number | null {
    const keepFor = this.options.keepFor()
    if (keepFor === 'session') return this.options.now()
    const days = ACTIVITY_KEEP_DAYS[keepFor]
    return days === null ? null : this.options.now() - days * DAY_MS
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

/**
 * The friends list history's saved copy (`friendLog.ts`), with the same rules
 * as the Activity list's: only the account signed in right now, and nothing
 * at all while activity is kept only until VRX closes. It is never removed by
 * age: "friends since" is only worth having if it stays.
 */
export class FriendHistory implements FriendLogStore {
  constructor(private readonly options: Omit<ActivityHistoryOptions, 'now'>) {}

  load(platform: Platform): SavedFriend[] | null {
    const accountKey = this.accountKey(platform)
    return accountKey === null ? null : this.options.database.savedFriends(accountKey)
  }

  save(platform: Platform, friends: readonly SavedFriend[]): void {
    const accountKey = this.accountKey(platform)
    if (accountKey !== null) this.options.database.saveFriends(accountKey, friends)
  }

  remove(platform: Platform, platformUserId: string): void {
    const accountKey = this.accountKey(platform)
    if (accountKey !== null) this.options.database.removeSavedFriend(accountKey, platformUserId)
  }

  nameChanged(platform: Platform, platformUserId: string, previousName: string, at: number): void {
    const accountKey = this.accountKey(platform)
    if (accountKey === null) return
    this.options.database.insertNameChange(accountKey, platformUserId, previousName, at)
  }

  friend(platform: Platform, platformUserId: string): SavedFriend | null {
    const accountKey = this.accountKey(platform)
    return accountKey === null
      ? null
      : this.options.database.savedFriend(accountKey, platformUserId)
  }

  names(platform: Platform, platformUserId: string, limit: number): SavedNameChange[] {
    const accountKey = this.accountKey(platform)
    return accountKey === null
      ? []
      : this.options.database.nameChanges(accountKey, platformUserId, limit)
  }

  clearAll(): void {
    this.options.database.deleteAllFriendHistory()
  }

  /** "Until VRX closes" removes what was saved, like the Activity list. */
  prune(): void {
    if (this.options.keepFor() === 'session') this.options.database.deleteAllFriendHistory()
  }

  private accountKey(platform: Platform): string | null {
    if (this.options.keepFor() === 'session') return null
    return this.options.accountKeyFor(platform)
  }
}
