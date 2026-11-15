/**
 * "Bring in VRCX history" (owner, 2026-11-15): on a press of that button, and
 * only then, read what VRCX saved on this computer about the signed-in VRChat
 * account and add it to VRX's own history:
 *
 * - the day each current friend was added, and the names they used before
 *   (VRCX's friend log);
 * - the rooms the user was in and who was there (VRCX's game log).
 *
 * VRCX's file is never opened for writing: the read runs against the private
 * copy `vrcxSessionImport.ts` makes and removes. Nothing is sent anywhere and
 * no platform is asked for anything. VRCX keeps no ChilloutVR history, so this
 * is VRChat only.
 *
 * Bringing the same history in twice adds nothing twice.
 */
import { DatabaseSync } from 'node:sqlite'
import type { VrcxHistoryImportResult } from '@shared/historyTransfer'
import type { HistoryDatabase } from './historyDatabase'

/** The largest VRCX database read for its history. */
export const MAX_VRCX_HISTORY_DATABASE_BYTES = 4 * 1024 ** 3

const CHUNK_ROWS = 2_000
const MAX_FRIEND_LOG_ROWS = 200_000
const MAX_JOIN_LEAVE_ROWS = 3_000_000
const MAX_TEXT_BYTES = 2_048

type SnapshotAnswer<T> = { ok: true; value: T } | { ok: false; reason: 'busy' | 'unavailable' }

export interface VrcxHistoryImportOptions {
  database: HistoryDatabase
  /** Whether activity is being saved at all, read again between steps. */
  isKeeping: () => boolean
  /** The signed-in VRChat account's key (`vrchat:<id>`), or null. */
  accountKey: () => string | null
  /** Rooms that began before this moment are left out; null keeps them all. */
  keepCutoff: () => number | null
  /** The most rooms brought in, newest first. */
  maxVisits: number
  /** Run one read against a private read-only copy of VRCX's database. */
  readSnapshot: <T>(
    read: (snapshotPath: string) => T | Promise<T>,
    maxBytes: number
  ) => Promise<SnapshotAnswer<T>>
  /** Give the rest of the app a turn between steps. */
  pause?: () => Promise<void>
}

type ReadOutcome =
  | { ok: true; friendsSince: number; names: number; visits: number; olderSkipped: boolean }
  | { ok: false; reason: 'no-history' | 'failed' }

interface ImportedVisit {
  enteredAt: number
  instanceId: string
  worldName: string | null
  /** Null when VRCX never saw the visit end. */
  leftAt: number | null
  id: number
  fresh: boolean
  /** The last moment anyone was seen in it. */
  lastSeen: number
}

export async function importVrcxHistory(
  options: VrcxHistoryImportOptions
): Promise<VrcxHistoryImportResult> {
  if (!options.isKeeping()) return { ok: false, reason: 'off' }
  const accountKey = options.accountKey()
  if (accountKey === null) return { ok: false, reason: 'signed-out' }
  const prefix = vrcxTablePrefix(accountKey.slice(accountKey.indexOf(':') + 1))
  if (prefix === null) return { ok: false, reason: 'signed-out' }

  const answer = await options.readSnapshot<ReadOutcome>(async (snapshotPath) => {
    const source = new DatabaseSync(snapshotPath, { readOnly: true, timeout: 25 })
    try {
      return await new Import(options, accountKey, prefix, source).run()
    } catch {
      return { ok: false, reason: 'failed' }
    } finally {
      source.close()
    }
  }, MAX_VRCX_HISTORY_DATABASE_BYTES)
  if (!answer.ok) return { ok: false, reason: answer.reason === 'busy' ? 'busy' : 'not-found' }
  return answer.value
}

/**
 * The prefix VRCX gives one account's tables: the account id without `-` and
 * `_`, with a leading `_` when it would begin with a digit. Null for an id
 * that could not be a table name.
 */
export function vrcxTablePrefix(accountId: string): string | null {
  const bare = accountId.replaceAll('-', '').replaceAll('_', '')
  if (!/^[A-Za-z0-9]{1,64}$/.test(bare)) return null
  return /^\d/.test(bare) ? `_${bare}` : bare
}

class Import {
  private readonly ownId: string

  constructor(
    private readonly options: VrcxHistoryImportOptions,
    private readonly accountKey: string,
    private readonly prefix: string,
    private readonly source: DatabaseSync
  ) {
    this.ownId = accountKey.slice(accountKey.indexOf(':') + 1).toLowerCase()
  }

  async run(): Promise<ReadOutcome> {
    const friendLog = `${this.prefix}_friend_log_history`
    const hasFriendLog = this.hasColumns(friendLog, [
      'id',
      'created_at',
      'type',
      'user_id',
      'display_name',
      'previous_display_name'
    ])
    const hasRooms = this.hasColumns('gamelog_location', [
      'id',
      'created_at',
      'location',
      'world_name',
      'time'
    ])
    const hasPeople = this.hasColumns('gamelog_join_leave', [
      'id',
      'created_at',
      'type',
      'display_name',
      'location',
      'user_id',
      'time'
    ])
    // VRCX makes an account's tables the first time it signs in there.
    if (!hasFriendLog) return { ok: false, reason: 'no-history' }

    const friends = await this.friendLog(friendLog)
    if (friends === null) return { ok: false, reason: 'failed' }
    let visits = 0
    let olderSkipped = false
    if (hasRooms) {
      const rooms = await this.rooms()
      if (rooms === null) return { ok: false, reason: 'failed' }
      olderSkipped = rooms.olderSkipped
      visits = rooms.visits.filter((visit) => visit.fresh).length
      if (hasPeople && visits > 0 && !(await this.people(rooms.visits))) {
        return { ok: false, reason: 'failed' }
      }
    }
    return { ok: true, friendsSince: friends.since, names: friends.names, visits, olderSkipped }
  }

  /** The day each friend was added, and their earlier names. */
  private async friendLog(table: string): Promise<{ since: number; names: number } | null> {
    // The newest "added" row per person, unless they were removed after it.
    const added = new Map<string, number | null>()
    const renames: Array<{ userId: string; previousName: string; at: number }> = []
    const read = this.source.prepare(
      `SELECT id, created_at, type, user_id, previous_display_name FROM \`${table}\`
       WHERE id > ? AND type IN ('Friend', 'Unfriend', 'DisplayName')
         AND octet_length(user_id) BETWEEN 1 AND ${MAX_TEXT_BYTES}
         AND (previous_display_name IS NULL OR octet_length(previous_display_name) <= ${MAX_TEXT_BYTES})
       ORDER BY id LIMIT ?`
    )
    let after = 0
    let total = 0
    for (;;) {
      const rows = read.all(after, CHUNK_ROWS) as Array<Record<string, unknown>>
      for (const row of rows) {
        if (typeof row.id === 'number') after = row.id
        const at = readTime(row.created_at)
        const userId = row.user_id
        if (at === null || typeof userId !== 'string') continue
        if (row.type === 'Friend') added.set(userId, at)
        else if (row.type === 'Unfriend') added.set(userId, null)
        else if (
          typeof row.previous_display_name === 'string' &&
          row.previous_display_name.trim() !== ''
        ) {
          renames.push({ userId, previousName: row.previous_display_name, at })
        }
      }
      total += rows.length
      if (rows.length < CHUNK_ROWS || total >= MAX_FRIEND_LOG_ROWS) break
      if (!(await this.next())) return null
    }

    let since = 0
    let names = 0
    const database = this.options.database
    database.batch(() => {
      for (const [userId, at] of added) {
        if (at !== null && database.importFriendSince(this.accountKey, userId, at)) since += 1
      }
      for (const rename of renames) {
        if (
          database.importNameChange(this.accountKey, rename.userId, rename.previousName, rename.at)
        ) {
          names += 1
        }
      }
    })
    return { since, names }
  }

  /** The rooms the user was in, oldest first. */
  private async rooms(): Promise<{ visits: ImportedVisit[]; olderSkipped: boolean } | null> {
    const cutoff = this.options.keepCutoff()
    const read = this.source.prepare(
      `SELECT id, created_at, location, world_name, time FROM gamelog_location
       WHERE id > ? AND octet_length(location) BETWEEN 1 AND ${MAX_TEXT_BYTES}
         AND (world_name IS NULL OR octet_length(world_name) <= ${MAX_TEXT_BYTES})
       ORDER BY id LIMIT ?`
    )
    const found: Array<Omit<ImportedVisit, 'id' | 'fresh' | 'lastSeen'>> = []
    let olderSkipped = false
    let after = 0
    for (;;) {
      const rows = read.all(after, CHUNK_ROWS) as Array<Record<string, unknown>>
      for (const row of rows) {
        if (typeof row.id === 'number') after = row.id
        const enteredAt = readTime(row.created_at)
        const instanceId = typeof row.location === 'string' ? cleanLocation(row.location) : null
        if (enteredAt === null || instanceId === null) continue
        if (cutoff !== null && enteredAt < cutoff) {
          olderSkipped = true
          continue
        }
        const stayed = typeof row.time === 'number' && row.time > 0 ? row.time : null
        found.push({
          enteredAt,
          instanceId,
          worldName:
            typeof row.world_name === 'string' && row.world_name.trim() !== ''
              ? row.world_name
              : null,
          leftAt: stayed === null ? null : enteredAt + stayed
        })
      }
      if (rows.length < CHUNK_ROWS) break
      if (!(await this.next())) return null
    }
    found.sort((a, b) => a.enteredAt - b.enteredAt)
    if (found.length > this.options.maxVisits) {
      found.splice(0, found.length - this.options.maxVisits)
      olderSkipped = true
    }

    const visits: ImportedVisit[] = []
    const database = this.options.database
    for (let start = 0; start < found.length; start += CHUNK_ROWS) {
      database.batch(() => {
        for (const [offset, room] of found.slice(start, start + CHUNK_ROWS).entries()) {
          // No room outlasts the next one's start.
          const next = found[start + offset + 1]
          const leftAt =
            room.leftAt === null || next === undefined
              ? room.leftAt
              : Math.min(room.leftAt, next.enteredAt)
          const saved = database.importVisit(this.accountKey, {
            instanceId: room.instanceId,
            worldName: room.worldName,
            enteredAt: room.enteredAt,
            // A room VRCX never saw end is filled in from who was seen in it.
            leftAt: leftAt ?? room.enteredAt
          })
          if (saved !== null) {
            visits.push({ ...room, leftAt, ...saved, lastSeen: room.enteredAt })
          }
        }
      })
      if (!(await this.next())) return null
    }
    return { visits, olderSkipped }
  }

  /** Who was in those rooms. Only rooms this run added are filled in. */
  private async people(visits: readonly ImportedVisit[]): Promise<boolean> {
    const first = visits[0]
    if (first === undefined) return true
    const database = this.options.database
    // Start at the first row that could belong to the oldest room kept.
    const newest = this.source
      .prepare('SELECT id FROM gamelog_join_leave ORDER BY id DESC LIMIT 1 OFFSET ?')
      .get(MAX_JOIN_LEAVE_ROWS) as { id?: unknown } | undefined
    let after = typeof newest?.id === 'number' ? newest.id : 0
    const read = this.source.prepare(
      `SELECT id, created_at, type, display_name, location, user_id, time FROM gamelog_join_leave
       WHERE id > ? AND created_at >= ? AND type IN ('OnPlayerJoined', 'OnPlayerLeft')
         AND octet_length(user_id) BETWEEN 1 AND ${MAX_TEXT_BYTES}
         AND octet_length(display_name) <= ${MAX_TEXT_BYTES}
         AND (location IS NULL OR octet_length(location) <= ${MAX_TEXT_BYTES})
       ORDER BY id LIMIT ?`
    )
    // Stored times are ISO text, so text order is time order to the second.
    const from = new Date(first.enteredAt).toISOString().slice(0, 19)

    const room: { open: ImportedVisit | null } = { open: null }
    const present = new Map<string, { joinedAt: number; displayName: string }>()
    const close = (visit: ImportedVisit): void => {
      const end = visit.leftAt ?? Math.max(visit.lastSeen, visit.enteredAt)
      for (const [userId, stay] of present) {
        database.importEncounter(this.accountKey, visit.id, {
          platformUserId: userId,
          displayName: stay.displayName,
          joinedAt: stay.joinedAt,
          leftAt: end
        })
      }
      present.clear()
      if (visit.leftAt === null) database.importVisitEnd(visit.id, end)
    }

    for (;;) {
      const rows = read.all(after, from, CHUNK_ROWS) as Array<Record<string, unknown>>
      database.batch(() => {
        for (const row of rows) {
          if (typeof row.id === 'number') after = row.id
          const at = readTime(row.created_at)
          const userId = row.user_id
          if (at === null || typeof userId !== 'string') continue
          if (userId.toLowerCase() === this.ownId) continue
          const visit = visitAt(visits, at)
          if (visit === null || !visit.fresh) continue
          // An old row may name no room, or "traveling"; the time decides then.
          const location = typeof row.location === 'string' ? cleanLocation(row.location) : null
          if (location !== null && location !== visit.instanceId) continue
          if (visit.leftAt !== null && at > visit.leftAt) continue
          if (room.open !== visit) {
            if (room.open !== null) close(room.open)
            room.open = visit
          }
          visit.lastSeen = Math.max(visit.lastSeen, at)
          const displayName = typeof row.display_name === 'string' ? row.display_name : ''
          if (row.type === 'OnPlayerJoined') {
            if (!present.has(userId)) present.set(userId, { joinedAt: at, displayName })
            continue
          }
          const stay = present.get(userId)
          present.delete(userId)
          const stayed = typeof row.time === 'number' && row.time > 0 ? row.time : null
          // A leaving with no arrival seen: VRCX's own count of the stay, if any.
          const joinedAt =
            stay?.joinedAt ?? (stayed === null ? null : Math.max(at - stayed, visit.enteredAt))
          if (joinedAt === null) continue
          database.importEncounter(this.accountKey, visit.id, {
            platformUserId: userId,
            displayName: displayName === '' ? (stay?.displayName ?? '') : displayName,
            joinedAt,
            leftAt: at
          })
        }
      })
      if (rows.length < CHUNK_ROWS) break
      if (!(await this.next())) return false
    }
    database.batch(() => {
      if (room.open !== null) close(room.open)
    })
    return true
  }

  /** Whether a table exists as a plain table with these columns. */
  private hasColumns(table: string, columns: readonly string[]): boolean {
    const found = this.source
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { found?: unknown } | undefined
    if (found?.found !== 1) return false
    const names = new Set(
      (
        this.source.prepare(`PRAGMA table_xinfo(\`${table}\`)`).all() as Array<{
          name?: unknown
          hidden?: unknown
        }>
      )
        .filter((column) => column.hidden === 0)
        .map((column) => column.name)
    )
    return columns.every((column) => names.has(column))
  }

  /** Between steps: let the app breathe, then make sure the same account is
   *  still signed in and still keeping history. */
  private async next(): Promise<boolean> {
    await (this.options.pause?.() ?? Promise.resolve())
    return this.options.isKeeping() && this.options.accountKey() === this.accountKey
  }
}

/** VRCX saves times as ISO text in UTC. */
function readTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.length < 19 || value.length > 40) return null
  const at = Date.parse(value)
  return Number.isSafeInteger(at) && at > 0 ? at : null
}

/** A room as the instance log names it: the join nonce is not part of it. */
function cleanLocation(location: string): string | null {
  if (!location.startsWith('wrld_')) return null
  const cleaned = location.replace(/~nonce\([^)]*\)/g, '').trim()
  return cleaned === '' ? null : cleaned
}

/** The room the user was in at a moment: the last one entered by then. */
function visitAt(visits: readonly ImportedVisit[], at: number): ImportedVisit | null {
  let low = 0
  let high = visits.length - 1
  let found: ImportedVisit | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    const visit = visits[middle]
    if (visit === undefined) break
    if (visit.enteredAt <= at) {
      found = visit
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
