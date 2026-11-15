/**
 * Saved history (owner, 2026-11-15): one SQLite file in VRX's own data folder,
 * `history.sqlite3`. Rows are keyed by the signed-in account; nothing in it is
 * ever sent anywhere, and nothing here asks a platform for anything.
 *
 * The file is a convenience, never a dependency. A file that cannot be opened
 * is set aside under a `history.corrupt-<time>` name (never deleted) and a new
 * one starts; a file from a newer VRX is left exactly as it is. In both cases,
 * and when the folder cannot be written at all, the session runs on a database
 * in memory, so every caller keeps working and simply saves nothing.
 */
import { chmodSync, existsSync, renameSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { ACTIVITY_KINDS, type ActivityEntry, type ActivityKind } from '@shared/activity'
import type { Platform } from '@shared/types'

/** The schema this build writes. Bump with a migration step below. */
export const HISTORY_SCHEMA_VERSION = 1

export const HISTORY_FILE_NAME = 'history.sqlite3'

/** How the database came up. `file` saves; the rest last until VRX closes. */
export type HistoryStorage = 'file' | 'memory-newer-file' | 'memory-unavailable'

export interface HistoryDatabaseOptions {
  /** Full path of the file, or null to run in memory (tests, no data folder). */
  path: string | null
  /** Wall clock, for the name a damaged file is set aside under. */
  now?: () => number
  /** Generic notices only: never a row, a name or an id. */
  log?: (message: string, meta?: Record<string, unknown>) => void
}

export interface SavedActivityRow {
  id: number
  accountKey: string
  kind: ActivityKind
  platformUserId: string
  displayName: string
  worldName: string | null
  /** `renamed` only. */
  previousName: string | null
  at: number
}

/** One friend as last seen on the friends list. */
export interface SavedFriend {
  platformUserId: string
  displayName: string
  /** When the friendship began as far as VRX knows (ms since the epoch). */
  since: number
  /** False for someone already a friend when history began. */
  sinceKnown: boolean
  /** Whole friends lists in a row they were missing from. */
  misses: number
}

export interface SavedNameChange {
  previousName: string
  at: number
}

/** One stay in one room, as saved. */
export interface SavedVisit {
  id: number
  accountKey: string
  worldName: string | null
  enteredAt: number
  leftAt: number | null
  people: number
}

export interface SavedVisitPerson {
  platformUserId: string
  displayName: string
  joinedAt: number
  leftAt: number | null
}

export interface SavedMetFacts {
  times: number
  togetherMs: number
  lastAt: number
  lastWorldName: string | null
}

export interface ActivityPageQuery {
  /** Each account to read, from its own place (null starts at the newest). */
  accounts: ReadonlyArray<{ accountKey: string; beforeId: number | null }>
  /** Only these kinds; null reads every kind. */
  kinds: readonly ActivityKind[] | null
  /** Only these people, each under their own account. */
  friends: ReadonlyArray<{ accountKey: string; platformUserId: string }> | null
  limit: number
}

const KNOWN_KINDS: ReadonlySet<unknown> = new Set<ActivityKind>(ACTIVITY_KINDS)
const SIDE_FILES = ['', '-wal', '-shm'] as const

/** Longest text a row may carry; longer values are cut on the way in. */
const MAX_TEXT_LENGTH = 512

/** A brought-in visit this close to a saved one of the same room is the same stay. */
const IMPORT_SAME_VISIT_MS = 60_000

/** The `instance_log_floor` row that stands for every account. */
const EVERY_ACCOUNT = ''

const HISTORY_TABLES = [
  'activity',
  'friend_roster',
  'friend_names',
  'visits',
  'encounters'
] as const

/** Restore: every table emptied, then filled from the attached backup. Text
 *  is cut to the same length as on any other way in. */
const RESTORE_SQL = `
  DELETE FROM encounters;
  DELETE FROM visits;
  DELETE FROM friend_names;
  DELETE FROM friend_roster;
  DELETE FROM activity;
  INSERT INTO activity (id, account_key, kind, user_id, display_name, world_name, previous_name, at)
    SELECT id, substr(account_key, 1, ${MAX_TEXT_LENGTH}), substr(kind, 1, 32),
           substr(user_id, 1, ${MAX_TEXT_LENGTH}), substr(display_name, 1, ${MAX_TEXT_LENGTH}),
           substr(world_name, 1, ${MAX_TEXT_LENGTH}), substr(previous_name, 1, ${MAX_TEXT_LENGTH}), at
    FROM backup.activity;
  INSERT INTO friend_roster (account_key, user_id, display_name, since, since_known, misses)
    SELECT substr(account_key, 1, ${MAX_TEXT_LENGTH}), substr(user_id, 1, ${MAX_TEXT_LENGTH}),
           substr(display_name, 1, ${MAX_TEXT_LENGTH}), since, since_known, misses
    FROM backup.friend_roster;
  INSERT INTO friend_names (id, account_key, user_id, previous_name, at)
    SELECT id, substr(account_key, 1, ${MAX_TEXT_LENGTH}), substr(user_id, 1, ${MAX_TEXT_LENGTH}),
           substr(previous_name, 1, ${MAX_TEXT_LENGTH}), at
    FROM backup.friend_names;
  INSERT INTO visits (id, account_key, instance_id, world_name, entered_at, left_at)
    SELECT id, substr(account_key, 1, ${MAX_TEXT_LENGTH}), substr(instance_id, 1, ${MAX_TEXT_LENGTH}),
           substr(world_name, 1, ${MAX_TEXT_LENGTH}), entered_at, left_at
    FROM backup.visits;
  INSERT INTO encounters (id, account_key, visit_id, user_id, display_name, joined_at, left_at)
    SELECT id, substr(account_key, 1, ${MAX_TEXT_LENGTH}), visit_id,
           substr(user_id, 1, ${MAX_TEXT_LENGTH}), substr(display_name, 1, ${MAX_TEXT_LENGTH}),
           joined_at, left_at
    FROM backup.encounters;
`

interface RawActivityRow {
  id?: unknown
  account_key?: unknown
  kind?: unknown
  user_id?: unknown
  display_name?: unknown
  world_name?: unknown
  previous_name?: unknown
  at?: unknown
}

interface RawFriendRow {
  user_id?: unknown
  display_name?: unknown
  since?: unknown
  since_known?: unknown
  misses?: unknown
}

export class HistoryDatabase {
  private db: DatabaseSync | null = null
  private storageKind: HistoryStorage = 'memory-unavailable'
  private readonly statements = new Map<string, StatementSync>()
  private readonly log: (message: string, meta?: Record<string, unknown>) => void
  private failed = false
  private inTransaction = false

  constructor(private readonly options: HistoryDatabaseOptions) {
    this.log = options.log ?? (() => undefined)
    this.open()
  }

  /** Whether rows written now survive a restart. */
  get storage(): HistoryStorage {
    return this.storageKind
  }

  /** The largest activity id ever saved, or 0. */
  maxActivityId(): number {
    return (
      this.attempt(() => {
        const row = this.statement('SELECT MAX(id) AS id FROM activity').get() as
          { id?: unknown } | undefined
        return typeof row?.id === 'number' && Number.isSafeInteger(row.id) ? row.id : 0
      }) ?? 0
    )
  }

  /** Save one entry under its account. An id already saved is left as it is. */
  insertActivity(row: SavedActivityRow): boolean {
    return (
      this.attempt(() => {
        this.statement(
          `INSERT OR IGNORE INTO activity
             (id, account_key, kind, user_id, display_name, world_name, previous_name, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          row.id,
          row.accountKey,
          row.kind,
          clip(row.platformUserId),
          clip(row.displayName),
          row.worldName === null ? null : clip(row.worldName),
          row.previousName === null ? null : clip(row.previousName),
          row.at
        )
        return true
      }) ?? false
    )
  }

  /** A world name that resolved after the entry was saved. */
  setActivityWorldName(id: number, worldName: string): void {
    this.attempt(() => {
      this.statement('UPDATE activity SET world_name = ? WHERE id = ? AND world_name IS NULL').run(
        clip(worldName),
        id
      )
    })
  }

  /** One account's newest entries, newest first. */
  recentActivity(accountKey: string, limit: number): SavedActivityRow[] {
    return this.pageActivity({
      accounts: [{ accountKey, beforeId: null }],
      kinds: null,
      friends: null,
      limit
    })
  }

  /** Entries in a scope, newest first, at most `limit`. */
  pageActivity(query: ActivityPageQuery): SavedActivityRow[] {
    if (query.accounts.length === 0 || query.limit <= 0) return []
    if (query.friends !== null && query.friends.length === 0) return []
    if (query.kinds !== null && query.kinds.length === 0) return []
    return (
      this.attempt(() => {
        const where: string[] = []
        const params: Array<string | number> = []
        const accounts: string[] = []
        for (const account of query.accounts) {
          if (account.beforeId === null) {
            accounts.push('account_key = ?')
            params.push(account.accountKey)
          } else {
            accounts.push('(account_key = ? AND id < ?)')
            params.push(account.accountKey, account.beforeId)
          }
        }
        where.push(`(${accounts.join(' OR ')})`)
        if (query.kinds !== null) {
          where.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
          params.push(...query.kinds)
        }
        if (query.friends !== null) {
          where.push(
            `(${query.friends.map(() => '(account_key = ? AND user_id = ?)').join(' OR ')})`
          )
          for (const friend of query.friends) params.push(friend.accountKey, friend.platformUserId)
        }
        const rows = this.statement(
          `SELECT id, account_key, kind, user_id, display_name, world_name, previous_name, at
           FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`
        ).all(...params, query.limit) as RawActivityRow[]
        const parsed: SavedActivityRow[] = []
        for (const row of rows) {
          const entry = parseActivityRow(row)
          if (entry !== null) parsed.push(entry)
        }
        return parsed
      }) ?? []
    )
  }

  /** Forget one account's entries, of some kinds or of every kind. */
  deleteActivity(accountKey: string, kinds: readonly ActivityKind[] | null): void {
    this.attempt(() => {
      if (kinds === null) {
        this.statement('DELETE FROM activity WHERE account_key = ?').run(accountKey)
        return
      }
      for (const kind of kinds) {
        this.statement('DELETE FROM activity WHERE account_key = ? AND kind = ?').run(
          accountKey,
          kind
        )
      }
    })
  }

  /** Forget every account's entries. */
  deleteAllActivity(): void {
    this.attempt(() => {
      this.statement('DELETE FROM activity').run()
      this.reclaim()
    })
  }

  /** Remove entries older than `olderThan` (ms since the epoch, or null for
   *  no age limit), then the oldest beyond `maxRows`. */
  pruneActivity(olderThan: number | null, maxRows: number): void {
    this.attempt(() => {
      let removed = 0
      if (olderThan !== null) {
        removed += Number(
          this.statement('DELETE FROM activity WHERE at < ?').run(olderThan).changes
        )
      }
      removed += Number(
        this.statement(
          `DELETE FROM activity WHERE id <= (
             SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?
           )`
        ).run(maxRows).changes
      )
      if (removed > 0) this.reclaim()
    })
  }

  // ── Friends list history ──────────────────────────────────────────────────

  /** The friends list as last saved for an account. Empty when none is saved. */
  savedFriends(accountKey: string): SavedFriend[] {
    return (
      this.attempt(() => {
        const rows = this.statement(
          'SELECT user_id, display_name, since, since_known, misses FROM friend_roster WHERE account_key = ?'
        ).all(accountKey) as RawFriendRow[]
        const friends: SavedFriend[] = []
        for (const row of rows) {
          const friend = parseFriendRow(row)
          if (friend !== null) friends.push(friend)
        }
        return friends
      }) ?? []
    )
  }

  /** One saved friend, or null. */
  savedFriend(accountKey: string, platformUserId: string): SavedFriend | null {
    return (
      this.attempt(() => {
        const row = this.statement(
          `SELECT user_id, display_name, since, since_known, misses FROM friend_roster
           WHERE account_key = ? AND user_id = ?`
        ).get(accountKey, platformUserId) as RawFriendRow | undefined
        return row === undefined ? null : parseFriendRow(row)
      }) ?? null
    )
  }

  /** Save friends in one step. A friend already saved keeps their `since`. */
  saveFriends(accountKey: string, friends: readonly SavedFriend[]): void {
    if (friends.length === 0) return
    this.attempt(() => {
      this.transaction(() => {
        const statement = this.statement(
          `INSERT INTO friend_roster (account_key, user_id, display_name, since, since_known, misses)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (account_key, user_id) DO UPDATE
             SET display_name = excluded.display_name, misses = excluded.misses`
        )
        for (const friend of friends) {
          statement.run(
            accountKey,
            clip(friend.platformUserId),
            clip(friend.displayName),
            friend.since,
            friend.sinceKnown ? 1 : 0,
            Number.isSafeInteger(friend.misses) && friend.misses > 0 ? friend.misses : 0
          )
        }
      })
    })
  }

  /** Someone is no longer on the friends list. */
  removeSavedFriend(accountKey: string, platformUserId: string): void {
    this.attempt(() => {
      this.statement('DELETE FROM friend_roster WHERE account_key = ? AND user_id = ?').run(
        accountKey,
        platformUserId
      )
    })
  }

  /** A friend took a new name: keep the one they had. */
  insertNameChange(
    accountKey: string,
    platformUserId: string,
    previousName: string,
    at: number
  ): void {
    this.attempt(() => {
      this.statement(
        'INSERT INTO friend_names (account_key, user_id, previous_name, at) VALUES (?, ?, ?, ?)'
      ).run(accountKey, clip(platformUserId), clip(previousName), at)
    })
  }

  /** The names a friend used before, newest change first. */
  nameChanges(accountKey: string, platformUserId: string, limit: number): SavedNameChange[] {
    return (
      this.attempt(() => {
        const rows = this.statement(
          `SELECT previous_name, at FROM friend_names
           WHERE account_key = ? AND user_id = ? ORDER BY at DESC, id DESC LIMIT ?`
        ).all(accountKey, platformUserId, limit) as Array<{ previous_name?: unknown; at?: unknown }>
        const changes: SavedNameChange[] = []
        for (const row of rows) {
          if (typeof row.previous_name !== 'string' || row.previous_name === '') continue
          if (typeof row.at !== 'number' || !Number.isFinite(row.at)) continue
          changes.push({ previousName: clip(row.previous_name), at: row.at })
        }
        return changes
      }) ?? []
    )
  }

  /** Forget every account's friends list history. */
  deleteAllFriendHistory(): void {
    this.attempt(() => {
      this.statement('DELETE FROM friend_roster').run()
      this.statement('DELETE FROM friend_names').run()
      this.reclaim()
    })
  }

  // ── Instance log ──────────────────────────────────────────────────────────

  /** Run many instance log writes as one step on disk (a whole game log read
   *  at launch). A write that fails inside is skipped; the rest still land. */
  batch(step: () => void): void {
    this.attempt(() => this.transaction(step))
  }

  /**
   * The user entered a room. The same room entered at the same moment is the
   * same visit, so reading a game log twice saves nothing twice. Returns the
   * visit's id, or null when nothing could be saved.
   */
  openVisit(
    accountKey: string,
    visit: { instanceId: string; worldName: string | null; enteredAt: number }
  ): number | null {
    return (
      this.attempt(() => {
        const instanceId = clip(visit.instanceId)
        this.statement(
          `INSERT OR IGNORE INTO visits (account_key, instance_id, world_name, entered_at)
           VALUES (?, ?, ?, ?)`
        ).run(
          accountKey,
          instanceId,
          visit.worldName === null ? null : clip(visit.worldName),
          visit.enteredAt
        )
        const row = this.statement(
          'SELECT id FROM visits WHERE account_key = ? AND instance_id = ? AND entered_at = ?'
        ).get(accountKey, instanceId, visit.enteredAt) as { id?: unknown } | undefined
        return typeof row?.id === 'number' ? row.id : null
      }) ?? null
    )
  }

  /** The world's name arrived after the visit began. A name already saved stays. */
  setVisitWorldName(visitId: number, worldName: string): void {
    this.attempt(() => {
      this.statement('UPDATE visits SET world_name = ? WHERE id = ? AND world_name IS NULL').run(
        clip(worldName),
        visitId
      )
    })
  }

  /** The user left: the visit ends, and so does everyone's stay in it. A
   *  visit already ended keeps its time. */
  closeVisit(visitId: number, leftAt: number): void {
    this.attempt(() => {
      this.transaction(() => {
        this.statement(
          'UPDATE encounters SET left_at = MAX(?, joined_at) WHERE visit_id = ? AND left_at IS NULL'
        ).run(leftAt, visitId)
        this.statement(
          'UPDATE visits SET left_at = MAX(?, entered_at) WHERE id = ? AND left_at IS NULL'
        ).run(leftAt, visitId)
      })
    })
  }

  /**
   * End every visit of an account that never saw its own end (the game closed
   * without saying so) and began before `before` (null for all of them).
   * Each ends at the last moment anything was seen in it.
   */
  closeStaleVisits(accountKey: string, before: number | null): void {
    this.attempt(() => {
      const rows = this.statement(
        `SELECT id, entered_at FROM visits
         WHERE account_key = ? AND left_at IS NULL AND entered_at < ?`
      ).all(accountKey, before ?? Number.MAX_SAFE_INTEGER) as Array<{
        id?: unknown
        entered_at?: unknown
      }>
      for (const row of rows) {
        if (typeof row.id !== 'number' || typeof row.entered_at !== 'number') continue
        const last = this.statement(
          `SELECT MAX(MAX(joined_at), COALESCE(MAX(left_at), 0)) AS at
           FROM encounters WHERE visit_id = ?`
        ).get(row.id) as { at?: unknown } | undefined
        const at = typeof last?.at === 'number' ? Math.max(last.at, row.entered_at) : row.entered_at
        this.closeVisit(row.id, at)
      }
    })
  }

  /** Someone was in the room with the user from `at`. Saved once per moment. */
  encounterJoined(
    accountKey: string,
    visitId: number,
    person: { platformUserId: string; displayName: string; at: number }
  ): void {
    if (person.platformUserId === '') return
    this.attempt(() => {
      this.statement(
        `INSERT OR IGNORE INTO encounters
           (account_key, visit_id, user_id, display_name, joined_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(accountKey, visitId, clip(person.platformUserId), clip(person.displayName), person.at)
    })
  }

  /** They left the room: their newest stay still open ends. */
  encounterLeft(visitId: number, platformUserId: string, at: number): void {
    this.attempt(() => {
      this.statement(
        `UPDATE encounters SET left_at = MAX(?, joined_at) WHERE id = (
           SELECT id FROM encounters
           WHERE visit_id = ? AND user_id = ? AND left_at IS NULL AND joined_at <= ?
           ORDER BY joined_at DESC LIMIT 1
         )`
      ).run(at, visitId, platformUserId, at)
    })
  }

  /** One page of visits across accounts, newest first, each account from its
   *  own place. */
  pageVisits(query: {
    accounts: ReadonlyArray<{ accountKey: string; before: number | null }>
    limit: number
  }): SavedVisit[] {
    if (query.accounts.length === 0 || query.limit <= 0) return []
    return (
      this.attempt(() => {
        const clauses: string[] = []
        const parameters: Array<string | number> = []
        for (const account of query.accounts) {
          if (account.before === null) {
            clauses.push('v.account_key = ?')
            parameters.push(account.accountKey)
          } else {
            clauses.push('(v.account_key = ? AND v.entered_at < ?)')
            parameters.push(account.accountKey, account.before)
          }
        }
        parameters.push(query.limit)
        const rows = this.statement(
          `SELECT v.id, v.account_key, v.world_name, v.entered_at, v.left_at,
                  (SELECT COUNT(DISTINCT e.user_id) FROM encounters e WHERE e.visit_id = v.id)
                    AS people
           FROM visits v
           WHERE ${clauses.join(' OR ')}
           ORDER BY v.entered_at DESC, v.id DESC LIMIT ?`
        ).all(...parameters) as RawVisitRow[]
        const visits: SavedVisit[] = []
        for (const row of rows) {
          const visit = parseVisitRow(row)
          if (visit !== null) visits.push(visit)
        }
        return visits
      }) ?? []
    )
  }

  /** Who was there during one visit of this account: each person once, with
   *  their first arrival and last leaving, in order of arrival. */
  visitPeople(accountKey: string, visitId: number, limit: number): SavedVisitPerson[] {
    return (
      this.attempt(() => {
        const rows = this.statement(
          `SELECT user_id, MIN(joined_at) AS joined_at,
                  CASE WHEN SUM(left_at IS NULL) > 0 THEN NULL ELSE MAX(left_at) END AS left_at,
                  (SELECT n.display_name FROM encounters n
                   WHERE n.visit_id = e.visit_id AND n.user_id = e.user_id
                   ORDER BY n.joined_at DESC LIMIT 1) AS display_name
           FROM encounters e
           WHERE e.visit_id = ? AND e.account_key = ?
           GROUP BY e.user_id ORDER BY MIN(e.joined_at), e.user_id LIMIT ?`
        ).all(visitId, accountKey, limit) as Array<{
          user_id?: unknown
          display_name?: unknown
          joined_at?: unknown
          left_at?: unknown
        }>
        const people: SavedVisitPerson[] = []
        for (const row of rows) {
          if (typeof row.user_id !== 'string' || row.user_id === '') continue
          if (typeof row.joined_at !== 'number') continue
          people.push({
            platformUserId: row.user_id,
            displayName: typeof row.display_name === 'string' ? clip(row.display_name) : '',
            joinedAt: row.joined_at,
            leftAt: typeof row.left_at === 'number' ? row.left_at : null
          })
        }
        return people
      }) ?? []
    )
  }

  /** What the instance log says about one person, or null when they were
   *  never seen. A stay still open counts as a meeting but adds no time yet. */
  metFacts(accountKey: string, platformUserId: string): SavedMetFacts | null {
    return (
      this.attempt(() => {
        const row = this.statement(
          `SELECT COUNT(DISTINCT e.visit_id) AS times,
                  SUM(COALESCE(e.left_at, v.left_at, e.joined_at) - e.joined_at) AS together,
                  MAX(COALESCE(e.left_at, v.left_at, e.joined_at)) AS last_at
           FROM encounters e JOIN visits v ON v.id = e.visit_id
           WHERE e.account_key = ? AND e.user_id = ?`
        ).get(accountKey, platformUserId) as
          { times?: unknown; together?: unknown; last_at?: unknown } | undefined
        if (typeof row?.times !== 'number' || row.times <= 0) return null
        if (typeof row.last_at !== 'number') return null
        const where = this.statement(
          `SELECT v.world_name FROM encounters e JOIN visits v ON v.id = e.visit_id
           WHERE e.account_key = ? AND e.user_id = ?
           ORDER BY e.joined_at DESC LIMIT 1`
        ).get(accountKey, platformUserId) as { world_name?: unknown } | undefined
        return {
          times: row.times,
          togetherMs: typeof row.together === 'number' && row.together > 0 ? row.together : 0,
          lastAt: row.last_at,
          lastWorldName: typeof where?.world_name === 'string' ? clip(where.world_name) : null
        }
      }) ?? null
    )
  }

  /**
   * Forget one account's instance log, as of `at`. The moment is kept
   * (`instanceLogFloor`), so a game log read again later does not bring back
   * what was forgotten.
   */
  deleteInstanceLog(accountKey: string, at: number): void {
    this.attempt(() => {
      this.transaction(() => {
        this.statement('DELETE FROM encounters WHERE account_key = ?').run(accountKey)
        this.statement('DELETE FROM visits WHERE account_key = ?').run(accountKey)
        this.statement(
          `INSERT INTO instance_log_floor (account_key, at) VALUES (?, ?)
           ON CONFLICT (account_key) DO UPDATE SET at = MAX(at, excluded.at)`
        ).run(accountKey, at)
      })
      this.reclaim()
    })
  }

  /** Forget every account's instance log, as of `at`. */
  deleteAllInstanceLog(at: number): void {
    this.attempt(() => {
      this.transaction(() => {
        this.statement('DELETE FROM encounters').run()
        this.statement('DELETE FROM visits').run()
        this.statement('DELETE FROM instance_log_floor').run()
        this.statement('INSERT INTO instance_log_floor (account_key, at) VALUES (?, ?)').run(
          EVERY_ACCOUNT,
          at
        )
      })
      this.reclaim()
    })
  }

  /** The moment an account's instance log was last forgotten, or 0. A room
   *  entered at or before it is not saved again. */
  instanceLogFloor(accountKey: string): number {
    const row = this.attempt(
      () =>
        this.statement(
          'SELECT MAX(at) AS at FROM instance_log_floor WHERE account_key IN (?, ?)'
        ).get(accountKey, EVERY_ACCOUNT) as { at?: unknown } | undefined
    )
    return typeof row?.at === 'number' ? row.at : 0
  }

  /** Remove ended visits that began before `olderThan` (null for no age
   *  limit), then the oldest ended visits beyond `maxVisits`. */
  pruneInstanceLog(olderThan: number | null, maxVisits: number): void {
    this.attempt(() => {
      let removed = 0
      this.transaction(() => {
        if (olderThan !== null) {
          this.statement(
            `DELETE FROM encounters WHERE visit_id IN (
               SELECT id FROM visits WHERE entered_at < ? AND left_at IS NOT NULL
             )`
          ).run(olderThan)
          removed += Number(
            this.statement('DELETE FROM visits WHERE entered_at < ? AND left_at IS NOT NULL').run(
              olderThan
            ).changes
          )
        }
        const cutoff = this.statement(
          'SELECT entered_at FROM visits ORDER BY entered_at DESC LIMIT 1 OFFSET ?'
        ).get(maxVisits) as { entered_at?: unknown } | undefined
        if (typeof cutoff?.entered_at === 'number') {
          this.statement(
            `DELETE FROM encounters WHERE visit_id IN (
               SELECT id FROM visits WHERE entered_at <= ? AND left_at IS NOT NULL
             )`
          ).run(cutoff.entered_at)
          removed += Number(
            this.statement('DELETE FROM visits WHERE entered_at <= ? AND left_at IS NOT NULL').run(
              cutoff.entered_at
            ).changes
          )
        }
      })
      if (removed > 0) this.reclaim()
    })
  }

  // ── Brought in from elsewhere, backup and restore ─────────────────────────

  /**
   * An earlier day a friendship is known to have begun (VRCX saw it). Only a
   * friend already saved is touched, and only toward an earlier or first-known
   * day. True when the day was taken.
   */
  importFriendSince(accountKey: string, platformUserId: string, since: number): boolean {
    return (
      this.attempt(
        () =>
          Number(
            this.statement(
              `UPDATE friend_roster SET since = ?, since_known = 1
               WHERE account_key = ? AND user_id = ? AND (since_known = 0 OR since > ?)`
            ).run(since, accountKey, platformUserId, since).changes
          ) > 0
      ) ?? false
    )
  }

  /** A name a saved friend used before, unless that change is already saved.
   *  True when it was added. */
  importNameChange(
    accountKey: string,
    platformUserId: string,
    previousName: string,
    at: number
  ): boolean {
    return (
      this.attempt(
        () =>
          Number(
            this.statement(
              `INSERT INTO friend_names (account_key, user_id, previous_name, at)
               SELECT ?1, ?2, ?3, ?4
               WHERE EXISTS (
                 SELECT 1 FROM friend_roster WHERE account_key = ?1 AND user_id = ?2
               ) AND NOT EXISTS (
                 SELECT 1 FROM friend_names
                 WHERE account_key = ?1 AND user_id = ?2 AND previous_name = ?3 AND at = ?4
               )`
            ).run(accountKey, clip(platformUserId), clip(previousName), at).changes
          ) > 0
      ) ?? false
    )
  }

  /** Whether a visit to this room that began within a minute of `enteredAt`
   *  is saved: the same stay, seen by VRX itself or brought in before. */
  hasVisitNear(accountKey: string, instanceId: string, enteredAt: number): boolean {
    return (
      this.attempt(
        () =>
          this.statement(
            `SELECT 1 AS found FROM visits
             WHERE account_key = ? AND instance_id = ? AND entered_at BETWEEN ? AND ? LIMIT 1`
          ).get(
            accountKey,
            clip(instanceId),
            enteredAt - IMPORT_SAME_VISIT_MS,
            enteredAt + IMPORT_SAME_VISIT_MS
          ) !== undefined
      ) ?? false
    )
  }

  /**
   * A stay in a room that already ended, with everyone who was there. The
   * room and its people land together or not at all, also inside a `batch`.
   * A stay already saved (`hasVisitNear`) is left as it is. True when the
   * room was added.
   */
  importVisit(
    accountKey: string,
    visit: { instanceId: string; worldName: string | null; enteredAt: number; leftAt: number },
    people: ReadonlyArray<{
      platformUserId: string
      displayName: string
      joinedAt: number
      leftAt: number
    }>
  ): boolean {
    if (this.hasVisitNear(accountKey, visit.instanceId, visit.enteredAt)) return false
    return (
      this.attempt(() => {
        const db = this.db
        if (db === null) return false
        // A savepoint, so the room is whole on its own inside a larger step.
        db.exec('SAVEPOINT brought_in_room')
        try {
          const visitId = Number(
            this.statement(
              `INSERT INTO visits (account_key, instance_id, world_name, entered_at, left_at)
               VALUES (?, ?, ?, ?, ?)`
            ).run(
              accountKey,
              clip(visit.instanceId),
              visit.worldName === null ? null : clip(visit.worldName),
              visit.enteredAt,
              Math.max(visit.leftAt, visit.enteredAt)
            ).lastInsertRowid
          )
          const add = this.statement(
            `INSERT OR IGNORE INTO encounters
               (account_key, visit_id, user_id, display_name, joined_at, left_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          for (const stay of people) {
            if (stay.platformUserId === '') continue
            add.run(
              accountKey,
              visitId,
              clip(stay.platformUserId),
              clip(stay.displayName),
              stay.joinedAt,
              Math.max(stay.leftAt, stay.joinedAt)
            )
          }
          db.exec('RELEASE brought_in_room')
          return true
        } catch (error) {
          try {
            db.exec('ROLLBACK TO brought_in_room')
            db.exec('RELEASE brought_in_room')
          } catch {
            // The step it was part of is already gone.
          }
          throw error
        }
      }) ?? false
    )
  }

  /** Write a whole copy of the history to a new file. False when it failed
   *  (the file must not exist yet). */
  backupTo(path: string): boolean {
    return (
      this.attempt(() => {
        const db = this.db
        if (db === null) return false
        db.prepare('VACUUM INTO ?').run(path)
        return true
      }) ?? false
    )
  }

  /**
   * Replace everything saved with the rows of a backup file. All of it lands
   * or none does. The file is only read; give it a private copy, since SQLite
   * may write beside a file it opens.
   */
  restoreFrom(path: string): 'restored' | 'not-a-backup' | 'newer' | 'failed' {
    const db = this.db
    if (db === null) return 'failed'
    try {
      db.prepare('ATTACH DATABASE ? AS backup').run(path)
    } catch {
      return 'not-a-backup'
    }
    try {
      let version: number
      try {
        const row = db.prepare('PRAGMA backup.user_version').get() as
          { user_version?: unknown } | undefined
        if (typeof row?.user_version !== 'number') return 'not-a-backup'
        version = row.user_version
        const tables = new Set<unknown>(
          (
            db
              .prepare("SELECT name FROM backup.sqlite_master WHERE type = 'table'")
              .all() as Array<{
              name?: unknown
            }>
          ).map((table) => table.name)
        )
        if (!HISTORY_TABLES.every((table) => tables.has(table))) return 'not-a-backup'
      } catch {
        return 'not-a-backup'
      }
      if (version > HISTORY_SCHEMA_VERSION) return 'newer'
      if (version < 1) return 'not-a-backup'
      try {
        this.transaction(() => {
          db.exec(RESTORE_SQL)
        })
      } catch {
        return 'failed'
      }
      this.attempt(() => this.reclaim())
      return 'restored'
    } finally {
      try {
        db.exec('DETACH DATABASE backup')
      } catch {
        // Nothing left to detach.
      }
    }
  }

  /** Flush and close. Safe to call twice. */
  close(): void {
    const db = this.db
    this.db = null
    this.statements.clear()
    if (db === null) return
    try {
      db.close()
    } catch {
      // Nothing useful to do at quit.
    }
  }

  private open(): void {
    const path = this.options.path
    if (path === null) {
      this.openInMemory('memory-unavailable')
      return
    }
    const first = this.tryOpenFile(path)
    if (first === 'opened') return
    if (first === 'newer') {
      this.log('history file is from a newer version; saving is off for this session')
      this.openInMemory('memory-newer-file')
      return
    }
    // Damaged or unreadable: set it aside, never delete, and start again.
    if (this.setAside(path) && this.tryOpenFile(path) === 'opened') {
      this.log('history file was damaged; started a new one')
      return
    }
    this.log('history file is unavailable; saving is off for this session')
    this.openInMemory('memory-unavailable')
  }

  private tryOpenFile(path: string): 'opened' | 'newer' | 'failed' {
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(path)
      const version = readUserVersion(db)
      if (version > HISTORY_SCHEMA_VERSION) {
        db.close()
        return 'newer'
      }
      // Only a file with no tables yet can choose its vacuum mode.
      if (version === 0) db.exec('PRAGMA auto_vacuum = INCREMENTAL')
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      migrate(db, version)
      // A cheap read proves the table is usable before anything relies on it.
      db.prepare('SELECT id FROM activity ORDER BY id DESC LIMIT 1').get()
      restrictToOwner(path)
      this.db = db
      this.storageKind = 'file'
      return 'opened'
    } catch {
      try {
        db?.close()
      } catch {
        // Already unusable.
      }
      return 'failed'
    }
  }

  private openInMemory(kind: HistoryStorage): void {
    try {
      const db = new DatabaseSync(':memory:')
      migrate(db, 0)
      this.db = db
    } catch {
      this.db = null
    }
    this.storageKind = kind
  }

  /** Move the file and its journal files out of the way. */
  private setAside(path: string): boolean {
    const stamp = (this.options.now ?? Date.now)()
    const base = path.replace(/\.sqlite3$/, '')
    try {
      for (const suffix of SIDE_FILES) {
        const source = `${path}${suffix}`
        if (!existsSync(source)) continue
        renameSync(source, `${base}.corrupt-${stamp}.sqlite3${suffix}`)
      }
      return true
    } catch {
      return false
    }
  }

  private statement(sql: string): StatementSync {
    const db = this.db
    if (db === null) throw new Error('history database is closed')
    let statement = this.statements.get(sql)
    if (statement === undefined) {
      statement = db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  /** Run several writes as one: all of them land, or none. */
  private transaction(step: () => void): void {
    const db = this.db
    if (db === null) throw new Error('history database is closed')
    // A step inside a running transaction is simply part of it.
    if (this.inTransaction) {
      step()
      return
    }
    db.exec('BEGIN')
    this.inTransaction = true
    try {
      step()
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The transaction is already gone.
      }
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  /** Give freed pages back to the disk. */
  private reclaim(): void {
    this.db?.exec('PRAGMA incremental_vacuum')
  }

  /** Run one database step. A failure is logged once and answers undefined;
   *  history never takes the app down with it. */
  private attempt<T>(step: () => T): T | undefined {
    if (this.db === null) return undefined
    try {
      return step()
    } catch {
      if (!this.failed) {
        this.failed = true
        this.log('history database step failed')
      }
      return undefined
    }
  }
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
  const version = row?.user_version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error('unreadable history version')
  }
  return version
}

function migrate(db: DatabaseSync, from: number): void {
  if (from >= HISTORY_SCHEMA_VERSION) return
  db.exec('BEGIN')
  try {
    if (from < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity (
          id INTEGER PRIMARY KEY,
          account_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          world_name TEXT,
          previous_name TEXT,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS activity_by_account ON activity (account_key, id);
        CREATE INDEX IF NOT EXISTS activity_by_friend ON activity (account_key, user_id, id);
        CREATE INDEX IF NOT EXISTS activity_by_time ON activity (at);
        CREATE TABLE IF NOT EXISTS friend_roster (
          account_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          since INTEGER NOT NULL,
          since_known INTEGER NOT NULL,
          misses INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (account_key, user_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS friend_names (
          id INTEGER PRIMARY KEY,
          account_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          previous_name TEXT NOT NULL,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS friend_names_by_friend
          ON friend_names (account_key, user_id, id);
        CREATE TABLE IF NOT EXISTS visits (
          id INTEGER PRIMARY KEY,
          account_key TEXT NOT NULL,
          instance_id TEXT NOT NULL,
          world_name TEXT,
          entered_at INTEGER NOT NULL,
          left_at INTEGER,
          UNIQUE (account_key, instance_id, entered_at)
        );
        CREATE INDEX IF NOT EXISTS visits_by_account ON visits (account_key, entered_at);
        CREATE TABLE IF NOT EXISTS encounters (
          id INTEGER PRIMARY KEY,
          account_key TEXT NOT NULL,
          visit_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          left_at INTEGER,
          UNIQUE (visit_id, user_id, joined_at)
        );
        CREATE INDEX IF NOT EXISTS encounters_by_person
          ON encounters (account_key, user_id, joined_at);
        CREATE TABLE IF NOT EXISTS instance_log_floor (
          account_key TEXT PRIMARY KEY,
          at INTEGER NOT NULL
        ) WITHOUT ROWID;
      `)
    }
    db.exec(`PRAGMA user_version = ${HISTORY_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The transaction is already gone.
    }
    throw error
  }
}

/** The file holds friends' activity: on POSIX only the owner may read it. */
function restrictToOwner(path: string): void {
  if (process.platform === 'win32') return
  for (const suffix of SIDE_FILES) {
    try {
      if (existsSync(`${path}${suffix}`)) chmodSync(`${path}${suffix}`, 0o600)
    } catch {
      // Best effort: the data folder is already private to the user.
    }
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}

/** A row as saved, or null when a hand-edited or damaged row is not usable. */
function parseActivityRow(row: RawActivityRow): SavedActivityRow | null {
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) return null
  if (typeof row.account_key !== 'string' || row.account_key === '') return null
  if (!KNOWN_KINDS.has(row.kind)) return null
  if (typeof row.user_id !== 'string' || row.user_id === '') return null
  if (typeof row.display_name !== 'string') return null
  if (row.world_name !== null && typeof row.world_name !== 'string') return null
  if (row.previous_name != null && typeof row.previous_name !== 'string') return null
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return null
  return {
    id: row.id,
    accountKey: row.account_key,
    kind: row.kind as ActivityKind,
    platformUserId: row.user_id,
    displayName: clip(row.display_name),
    worldName: row.world_name === null || row.world_name === '' ? null : clip(row.world_name),
    previousName:
      row.previous_name == null || row.previous_name === '' ? null : clip(row.previous_name),
    at: row.at
  }
}

function parseFriendRow(row: RawFriendRow): SavedFriend | null {
  if (typeof row.user_id !== 'string' || row.user_id === '') return null
  if (typeof row.display_name !== 'string') return null
  if (typeof row.since !== 'number' || !Number.isFinite(row.since)) return null
  return {
    platformUserId: row.user_id,
    displayName: clip(row.display_name),
    since: row.since,
    sinceKnown: row.since_known === 1,
    misses: typeof row.misses === 'number' && Number.isSafeInteger(row.misses) ? row.misses : 0
  }
}

interface RawVisitRow {
  id?: unknown
  account_key?: unknown
  world_name?: unknown
  entered_at?: unknown
  left_at?: unknown
  people?: unknown
}

function parseVisitRow(row: RawVisitRow): SavedVisit | null {
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) return null
  if (typeof row.account_key !== 'string' || row.account_key === '') return null
  if (typeof row.entered_at !== 'number' || !Number.isFinite(row.entered_at)) return null
  return {
    id: row.id,
    accountKey: row.account_key,
    worldName:
      typeof row.world_name === 'string' && row.world_name !== '' ? clip(row.world_name) : null,
    enteredAt: row.entered_at,
    leftAt: typeof row.left_at === 'number' ? row.left_at : null,
    people: typeof row.people === 'number' && row.people > 0 ? row.people : 0
  }
}

/** The platform an account key belongs to, or null for a key VRX never wrote. */
export function platformOfAccountKey(accountKey: string): Platform | null {
  if (accountKey.startsWith('vrchat:')) return 'vrchat'
  if (accountKey.startsWith('chilloutvr:')) return 'chilloutvr'
  return null
}

/** The renderer's shape of a saved row. */
export function toActivityEntry(row: SavedActivityRow): ActivityEntry | null {
  const platform = platformOfAccountKey(row.accountKey)
  if (platform === null) return null
  return {
    id: row.id,
    kind: row.kind,
    platform,
    platformUserId: row.platformUserId,
    displayName: row.displayName,
    worldName: row.worldName,
    ...(row.previousName === null ? {} : { previousName: row.previousName }),
    at: row.at
  }
}
