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
import type { ActivityEntry, ActivityKind } from '@shared/activity'
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
  at: number
}

export interface ActivityPageQuery {
  /** Each account to read, from its own place (null starts at the newest). */
  accounts: ReadonlyArray<{ accountKey: string; beforeId: number | null }>
  kind: ActivityKind | null
  /** Only these people, each under their own account. */
  friends: ReadonlyArray<{ accountKey: string; platformUserId: string }> | null
  limit: number
}

const ACTIVITY_KINDS: ReadonlySet<unknown> = new Set<ActivityKind>(['online', 'world', 'offline'])
const SIDE_FILES = ['', '-wal', '-shm'] as const

/** Longest text a row may carry; longer values are cut on the way in. */
const MAX_TEXT_LENGTH = 512

interface RawActivityRow {
  id?: unknown
  account_key?: unknown
  kind?: unknown
  user_id?: unknown
  display_name?: unknown
  world_name?: unknown
  at?: unknown
}

export class HistoryDatabase {
  private db: DatabaseSync | null = null
  private storageKind: HistoryStorage = 'memory-unavailable'
  private readonly statements = new Map<string, StatementSync>()
  private readonly log: (message: string, meta?: Record<string, unknown>) => void
  private failed = false

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
          `INSERT OR IGNORE INTO activity (id, account_key, kind, user_id, display_name, world_name, at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          row.id,
          row.accountKey,
          row.kind,
          clip(row.platformUserId),
          clip(row.displayName),
          row.worldName === null ? null : clip(row.worldName),
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
      kind: null,
      friends: null,
      limit
    })
  }

  /** Entries in a scope, newest first, at most `limit`. */
  pageActivity(query: ActivityPageQuery): SavedActivityRow[] {
    if (query.accounts.length === 0 || query.limit <= 0) return []
    if (query.friends !== null && query.friends.length === 0) return []
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
        if (query.kind !== null) {
          where.push('kind = ?')
          params.push(query.kind)
        }
        if (query.friends !== null) {
          where.push(
            `(${query.friends.map(() => '(account_key = ? AND user_id = ?)').join(' OR ')})`
          )
          for (const friend of query.friends) params.push(friend.accountKey, friend.platformUserId)
        }
        const rows = this.statement(
          `SELECT id, account_key, kind, user_id, display_name, world_name, at
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

  /** Forget one account's entries, of one kind or of every kind. */
  deleteActivity(accountKey: string, kind: ActivityKind | null): void {
    this.attempt(() => {
      if (kind === null) {
        this.statement('DELETE FROM activity WHERE account_key = ?').run(accountKey)
      } else {
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
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS activity_by_account ON activity (account_key, id);
        CREATE INDEX IF NOT EXISTS activity_by_friend ON activity (account_key, user_id, id);
        CREATE INDEX IF NOT EXISTS activity_by_time ON activity (at);
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
  if (!ACTIVITY_KINDS.has(row.kind)) return null
  if (typeof row.user_id !== 'string' || row.user_id === '') return null
  if (typeof row.display_name !== 'string') return null
  if (row.world_name !== null && typeof row.world_name !== 'string') return null
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return null
  return {
    id: row.id,
    accountKey: row.account_key,
    kind: row.kind as ActivityKind,
    platformUserId: row.user_id,
    displayName: clip(row.display_name),
    worldName: row.world_name === null || row.world_name === '' ? null : clip(row.world_name),
    at: row.at
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
    at: row.at
  }
}
