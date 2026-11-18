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
 *
 * VRCX keeps one game log for every VRChat account used in it. When it holds
 * more than one account's tables, a room is brought in only when this
 * account's own arrival or leaving was seen in it; the rest are left out and
 * the result says so.
 *
 * The run waits while the copy is made and between steps. Every write goes
 * through `HistoryDatabase.job`, which asks again at that moment whether
 * history is still kept and the same account is still signed in.
 */
import { DatabaseSync } from 'node:sqlite'
import type { VrcxHistoryImportResult } from '@shared/historyTransfer'
import type { HistoryDatabase, HistoryJobWrites } from './historyDatabase'

/** The largest VRCX database read for its history. */
export const MAX_VRCX_HISTORY_DATABASE_BYTES = 4 * 1024 ** 3

const CHUNK_ROWS = 2_000
const MAX_FRIEND_LOG_ROWS = 200_000
const MAX_JOIN_LEAVE_ROWS = 3_000_000
const MAX_TEXT_BYTES = 2_048

type SnapshotAnswer<T> = { ok: true; value: T } | { ok: false; reason: 'busy' | 'unavailable' }

export interface VrcxHistoryImportOptions {
  database: HistoryDatabase
  /** Whether activity is being saved at all, read again at every write. */
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
  | {
      ok: true
      friendsSince: number
      names: number
      visits: number
      olderSkipped: boolean
      otherAccountSkipped: boolean
    }
  | { ok: false; reason: 'off' | 'signed-out' | 'no-history' | 'failed' }

interface FoundRoom {
  enteredAt: number
  instanceId: string
  worldName: string | null
  /** Null when VRCX never saw the visit end. */
  leftAt: number | null
}

/** Someone's stay in the room being read, until the room is saved. */
interface Stay {
  platformUserId: string
  displayName: string
  joinedAt: number
  leftAt: number
}

export async function importVrcxHistory(
  options: VrcxHistoryImportOptions
): Promise<VrcxHistoryImportResult> {
  if (!options.isKeeping()) return { ok: false, reason: 'off' }
  const accountKey = options.accountKey()
  if (accountKey === null) return { ok: false, reason: 'signed-out' }
  const prefix = vrcxTablePrefix(accountKey.slice(accountKey.indexOf(':') + 1))
  if (prefix === null) return { ok: false, reason: 'signed-out' }

  const writes = options.database.job(
    () => options.isKeeping() && options.accountKey() === accountKey
  )
  const answer = await options.readSnapshot<ReadOutcome>(async (snapshotPath) => {
    // Making the copy took a while. What was true before it is asked again
    // here, and by `writes` at every write after it.
    if (!writes.holds()) return stopped(options)
    const source = new DatabaseSync(snapshotPath, { readOnly: true, timeout: 25 })
    try {
      return await new Import(options, writes, accountKey, prefix, source).run()
    } catch {
      return { ok: false, reason: 'failed' }
    } finally {
      source.close()
    }
  }, MAX_VRCX_HISTORY_DATABASE_BYTES)
  if (!answer.ok) return { ok: false, reason: answer.reason === 'busy' ? 'busy' : 'not-found' }
  return answer.value
}

/** Why a run that may no longer write stopped. */
function stopped(options: VrcxHistoryImportOptions): ReadOutcome {
  if (!options.isKeeping()) return { ok: false, reason: 'off' }
  return { ok: false, reason: options.accountKey() === null ? 'signed-out' : 'failed' }
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
    /** The only way this run writes: each write asks again whether it may. */
    private readonly writes: HistoryJobWrites,
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
    if (friends === null) return stopped(this.options)
    let visits = 0
    let olderSkipped = false
    let otherAccountSkipped = false
    if (hasRooms) {
      const rooms = await this.rooms()
      if (rooms === null) return stopped(this.options)
      olderSkipped = rooms.olderSkipped
      // The game log is one for every account VRCX knows. With another
      // account's tables beside this one's, a room needs proof it is ours.
      const saved = await this.save(rooms.found, hasPeople, this.holdsAnotherAccount(friendLog))
      if (saved === null) return stopped(this.options)
      visits = saved.added
      otherAccountSkipped = saved.unproven
    }
    return {
      ok: true,
      friendsSince: friends.since,
      names: friends.names,
      visits,
      olderSkipped,
      otherAccountSkipped
    }
  }

  /** Whether VRCX holds a friend log for an account other than this one:
   *  it makes one the first time an account signs in there. */
  private holdsAnotherAccount(ownFriendLog: string): boolean {
    const other = this.source
      .prepare(
        `SELECT 1 AS found FROM sqlite_master
         WHERE type = 'table' AND name LIKE '%!_friend!_log!_history' ESCAPE '!' AND name <> ?
         LIMIT 1`
      )
      .get(ownFriendLog) as { found?: unknown } | undefined
    return other?.found === 1
  }

  /** The day each friend was added, and their earlier names. Null when the
   *  run had to stop. */
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
    const writes = this.writes
    const wrote = writes.batch(() => {
      for (const [userId, at] of added) {
        if (at !== null && writes.importFriendSince(this.accountKey, userId, at)) since += 1
      }
      for (const rename of renames) {
        if (
          writes.importNameChange(this.accountKey, rename.userId, rename.previousName, rename.at)
        ) {
          names += 1
        }
      }
    })
    return wrote ? { since, names } : null
  }

  /** The rooms the user was in, oldest first. Nothing is saved here. */
  private async rooms(): Promise<{ found: FoundRoom[]; olderSkipped: boolean } | null> {
    const cutoff = this.options.keepCutoff()
    const read = this.source.prepare(
      `SELECT id, created_at, location, world_name, time FROM gamelog_location
       WHERE id > ? AND octet_length(location) BETWEEN 1 AND ${MAX_TEXT_BYTES}
         AND (world_name IS NULL OR octet_length(world_name) <= ${MAX_TEXT_BYTES})
       ORDER BY id LIMIT ?`
    )
    const found: FoundRoom[] = []
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
    // No room outlasts the next one's start.
    for (const [index, room] of found.entries()) {
      const next = found[index + 1]
      if (room.leftAt !== null && next !== undefined) {
        room.leftAt = Math.min(room.leftAt, next.enteredAt)
      }
    }
    return { found, olderSkipped }
  }

  /**
   * Save the rooms, each together with who was in it, oldest first. A room
   * and its people land in one step on disk or not at all, so a run that
   * stops part way leaves only whole rooms and the next run adds the rest.
   *
   * With `needProof`, a room is saved only when this account's own arrival or
   * leaving was read in it; `unproven` says some were left out for that.
   * Returns null when the run had to stop.
   */
  private async save(
    rooms: readonly FoundRoom[],
    withPeople: boolean,
    needProof: boolean
  ): Promise<{ added: number; unproven: boolean } | null> {
    const database = this.options.database
    const writes = this.writes
    let added = 0
    let unproven = false
    /** Every room before this one is settled: saved, or already there. */
    let settled = 0
    /** The room whose people are being read; it is always `settled`. */
    let open: FoundRoom | null = null
    /** Whether this account was seen in the open room. */
    let proven = false
    let lastSeen = 0
    const stays: Stay[] = []
    const present = new Map<string, { joinedAt: number; displayName: string }>()

    const isKnown = (room: FoundRoom): boolean =>
      database.hasVisitNear(this.accountKey, room.instanceId, room.enteredAt)
    const write = (room: FoundRoom, people: boolean): void => {
      // A room VRCX never saw end lasted until the last moment anyone was seen.
      const end = room.leftAt ?? (people ? Math.max(lastSeen, room.enteredAt) : room.enteredAt)
      if (people) {
        for (const [platformUserId, stay] of present) {
          stays.push({ platformUserId, ...stay, leftAt: end })
        }
      }
      const saved = writes.importVisit(
        this.accountKey,
        {
          instanceId: room.instanceId,
          worldName: room.worldName,
          enteredAt: room.enteredAt,
          leftAt: end
        },
        people ? stays : []
      )
      if (saved) added += 1
    }
    /** Settle every room before `index`. Call inside a batch. */
    const settleBefore = (index: number): void => {
      for (; settled < index; settled += 1) {
        const room = rooms[settled]
        if (room === undefined) continue
        if (room === open) {
          if (proven || !needProof) write(room, true)
          else unproven = true
          open = null
          stays.length = 0
          present.clear()
        } else if (!isKnown(room)) {
          // No one was read in this room, so nothing says whose it was.
          if (needProof) unproven = true
          else write(room, false)
        }
      }
    }

    if (withPeople && rooms[0] !== undefined) {
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
      const from = new Date(rooms[0].enteredAt).toISOString().slice(0, 19)

      for (;;) {
        const rows = read.all(after, from, CHUNK_ROWS) as Array<Record<string, unknown>>
        const wrote = writes.batch(() => {
          for (const row of rows) {
            if (typeof row.id === 'number') after = row.id
            const at = readTime(row.created_at)
            const userId = row.user_id
            if (at === null || typeof userId !== 'string') continue
            const index = roomAt(rooms, at)
            const room = rooms[index]
            // A row for a room already settled came too late to count.
            if (room === undefined || index < settled) continue
            // An old row may name no room, or "traveling"; the time decides then.
            const location = typeof row.location === 'string' ? cleanLocation(row.location) : null
            if (location !== null && location !== room.instanceId) continue
            if (room.leftAt !== null && at > room.leftAt) continue
            if (room !== open) {
              settleBefore(index)
              if (isKnown(room)) {
                // VRX has this stay already: it is left as it is.
                settled = index + 1
                continue
              }
              open = room
              proven = false
              lastSeen = room.enteredAt
            }
            // The user's own row is no meeting: it says the room is theirs.
            if (userId.toLowerCase() === this.ownId) {
              proven = true
              continue
            }
            lastSeen = Math.max(lastSeen, at)
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
              stay?.joinedAt ?? (stayed === null ? null : Math.max(at - stayed, room.enteredAt))
            if (joinedAt === null) continue
            stays.push({
              platformUserId: userId,
              displayName: displayName === '' ? (stay?.displayName ?? '') : displayName,
              joinedAt,
              leftAt: at
            })
          }
        })
        if (!wrote) return null
        if (rows.length < CHUNK_ROWS) break
        if (!(await this.next())) return null
      }
    }

    // The rooms after the last person seen, and every room when VRCX kept no
    // record of people.
    for (;;) {
      if (!writes.batch(() => settleBefore(Math.min(settled + CHUNK_ROWS, rooms.length)))) {
        return null
      }
      if (settled >= rooms.length) break
      if (!(await this.next())) return null
    }
    return { added, unproven }
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
    return this.writes.holds()
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

/** The room the user was in at a moment: the last one entered by then.
 *  -1 when it was before the first. */
function roomAt(rooms: readonly FoundRoom[], at: number): number {
  let low = 0
  let high = rooms.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    const room = rooms[middle]
    if (room === undefined) break
    if (room.enteredAt <= at) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
