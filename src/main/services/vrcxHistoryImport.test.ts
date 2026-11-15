import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryDatabase } from './historyDatabase'
import {
  importVrcxHistory,
  vrcxTablePrefix,
  type VrcxHistoryImportOptions
} from './vrcxHistoryImport'

const ME = 'usr_11111111-2222-3333-4444-555555555555'
const KEY = `vrchat:${ME}`
const PREFIX = 'usr11111111222233334444555555555555'
const ROOM = 'wrld_aaaa:12345~private(usr_host)'
const iso = (at: number): string => new Date(at).toISOString()
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0)
const MINUTE = 60_000

let dir: string
let vrcxPath: string
let vrcx: DatabaseSync
let database: HistoryDatabase
let keeping: boolean
let accountKey: string | null
let cutoff: number | null
let snapshot: 'ok' | 'busy' | 'unavailable'

function options(overrides: Partial<VrcxHistoryImportOptions> = {}): VrcxHistoryImportOptions {
  return {
    database,
    isKeeping: () => keeping,
    accountKey: () => accountKey,
    keepCutoff: () => cutoff,
    maxVisits: 1_000,
    readSnapshot: async (read) => {
      if (snapshot !== 'ok') return { ok: false, reason: snapshot }
      vrcx.close()
      try {
        return { ok: true, value: await read(vrcxPath) }
      } finally {
        vrcx = new DatabaseSync(vrcxPath)
      }
    },
    ...overrides
  }
}

function friendLogRow(
  type: string,
  userId: string,
  at: number,
  names: { now?: string; before?: string } = {}
): void {
  vrcx
    .prepare(
      `INSERT INTO ${PREFIX}_friend_log_history
         (created_at, type, user_id, display_name, previous_display_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(iso(at), type, userId, names.now ?? 'Name', names.before ?? null)
}

function room(location: string, at: number, stayedMs: number, worldName = 'The Room'): void {
  vrcx
    .prepare(
      'INSERT INTO gamelog_location (created_at, location, world_id, world_name, time) VALUES (?, ?, ?, ?, ?)'
    )
    .run(iso(at), location, location.split(':')[0] ?? '', worldName, stayedMs)
}

function person(
  type: 'OnPlayerJoined' | 'OnPlayerLeft',
  userId: string,
  name: string,
  at: number,
  stayedMs = 0,
  location = ROOM
): void {
  vrcx
    .prepare(
      'INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(iso(at), type, name, location, userId, stayedMs)
}

/** Many rows as one write, so a large VRCX file is quick to build. */
function bulk(step: () => void): void {
  vrcx.exec('BEGIN')
  step()
  vrcx.exec('COMMIT')
}

function friend(userId: string, displayName: string, since: number, sinceKnown = false): void {
  database.saveFriends(KEY, [{ platformUserId: userId, displayName, since, sinceKnown, misses: 0 }])
}

function visits(): ReturnType<HistoryDatabase['pageVisits']> {
  return database.pageVisits({ accounts: [{ accountKey: KEY, before: null }], limit: 100 })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vrx-vrcx-history-'))
  vrcxPath = join(dir, 'VRCX.sqlite3')
  vrcx = new DatabaseSync(vrcxPath)
  vrcx.exec(`
    CREATE TABLE ${PREFIX}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER);
    CREATE TABLE gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, UNIQUE(created_at, location));
    CREATE TABLE gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, UNIQUE(created_at, type, display_name));
  `)
  database = new HistoryDatabase({ path: null })
  keeping = true
  accountKey = KEY
  cutoff = null
  snapshot = 'ok'
})

afterEach(() => {
  vrcx.close()
  database.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('vrcxTablePrefix', () => {
  it('names an account the way VRCX does', () => {
    expect(vrcxTablePrefix(ME)).toBe(PREFIX)
    expect(vrcxTablePrefix('8JoV9XEdpo')).toBe('_8JoV9XEdpo')
  })

  it('refuses an id that could not be a table name', () => {
    expect(vrcxTablePrefix('')).toBeNull()
    expect(vrcxTablePrefix('usr_a` --')).toBeNull()
    expect(vrcxTablePrefix('a'.repeat(80))).toBeNull()
  })
})

describe('importVrcxHistory', () => {
  it('does nothing while history is not kept or no VRChat account is signed in', async () => {
    keeping = false
    await expect(importVrcxHistory(options())).resolves.toEqual({ ok: false, reason: 'off' })
    keeping = true
    accountKey = null
    await expect(importVrcxHistory(options())).resolves.toEqual({
      ok: false,
      reason: 'signed-out'
    })
  })

  it('says when VRCX is open and when it is not on this computer', async () => {
    snapshot = 'busy'
    await expect(importVrcxHistory(options())).resolves.toEqual({ ok: false, reason: 'busy' })
    snapshot = 'unavailable'
    await expect(importVrcxHistory(options())).resolves.toEqual({
      ok: false,
      reason: 'not-found'
    })
  })

  it('says when VRCX holds nothing for this account', async () => {
    accountKey = 'vrchat:usr_someone-else'
    await expect(importVrcxHistory(options())).resolves.toEqual({
      ok: false,
      reason: 'no-history'
    })
  })

  it('learns the day a current friend was added, and never a later one', async () => {
    friend('usr_a', 'Alice', T0 + 90 * MINUTE)
    friend('usr_b', 'Bo', T0 - 500 * MINUTE, true)
    friend('usr_c', 'Cy', T0 + 90 * MINUTE)
    friendLogRow('Friend', 'usr_a', T0)
    friendLogRow('Friend', 'usr_b', T0)
    // Removed after being added: the day no longer says anything.
    friendLogRow('Friend', 'usr_c', T0)
    friendLogRow('Unfriend', 'usr_c', T0 + MINUTE)
    // Not a friend now: nothing is saved about them.
    friendLogRow('Friend', 'usr_stranger', T0)

    const result = await importVrcxHistory(options())
    expect(result).toMatchObject({ ok: true, friendsSince: 1 })
    expect(database.savedFriend(KEY, 'usr_a')).toMatchObject({ since: T0, sinceKnown: true })
    expect(database.savedFriend(KEY, 'usr_b')).toMatchObject({ since: T0 - 500 * MINUTE })
    expect(database.savedFriend(KEY, 'usr_c')).toMatchObject({ sinceKnown: false })
    expect(database.savedFriend(KEY, 'usr_stranger')).toBeNull()
  })

  it('adds earlier names once, newest change first', async () => {
    friend('usr_a', 'Alice', T0)
    database.insertNameChange(KEY, 'usr_a', 'Ali', T0 + 10 * MINUTE)
    friendLogRow('DisplayName', 'usr_a', T0 - MINUTE, { now: 'Ali', before: 'Al' })
    friendLogRow('DisplayName', 'usr_a', T0 - 5 * MINUTE, { now: 'Al', before: 'A' })
    friendLogRow('DisplayName', 'usr_stranger', T0, { now: 'X', before: 'Y' })

    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, names: 2 })
    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, names: 0 })
    expect(database.nameChanges(KEY, 'usr_a', 10).map((change) => change.previousName)).toEqual([
      'Ali',
      'Al',
      'A'
    ])
    expect(database.nameChanges(KEY, 'usr_stranger', 10)).toEqual([])
  })

  it('brings in rooms and who was there, pairing arrivals with leavings', async () => {
    room(`${ROOM}~nonce(ABCDEF)`, T0, 30 * MINUTE)
    person('OnPlayerJoined', ME, 'Me', T0)
    person('OnPlayerJoined', 'usr_a', 'Alice', T0 + MINUTE)
    person('OnPlayerLeft', 'usr_a', 'Alice', T0 + 11 * MINUTE, 10 * MINUTE)
    // Was there before VRCX started watching: only the leaving is known.
    person('OnPlayerLeft', 'usr_b', 'Bo', T0 + 20 * MINUTE, 15 * MINUTE)
    // Never seen leaving: there until the user left.
    person('OnPlayerJoined', 'usr_c', 'Cy', T0 + 25 * MINUTE)
    // No id: cannot be told apart from anyone else of that name.
    person('OnPlayerJoined', '', 'Nameless', T0 + 2 * MINUTE)

    const result = await importVrcxHistory(options())
    expect(result).toEqual({ ok: true, friendsSince: 0, names: 0, visits: 1, olderSkipped: false })
    const [visit] = visits()
    expect(visit).toMatchObject({
      worldName: 'The Room',
      enteredAt: T0,
      leftAt: T0 + 30 * MINUTE,
      people: 3
    })
    expect(database.visitPeople(KEY, visit?.id ?? 0, 10)).toEqual([
      {
        platformUserId: 'usr_a',
        displayName: 'Alice',
        joinedAt: T0 + MINUTE,
        leftAt: T0 + 11 * MINUTE
      },
      {
        platformUserId: 'usr_b',
        displayName: 'Bo',
        joinedAt: T0 + 5 * MINUTE,
        leftAt: T0 + 20 * MINUTE
      },
      {
        platformUserId: 'usr_c',
        displayName: 'Cy',
        joinedAt: T0 + 25 * MINUTE,
        leftAt: T0 + 30 * MINUTE
      }
    ])
    expect(database.metFacts(KEY, 'usr_a')).toMatchObject({ times: 1, togetherMs: 10 * MINUTE })
  })

  it('ends a room VRCX never saw end at the last moment anyone was seen', async () => {
    room(ROOM, T0, 0)
    person('OnPlayerJoined', 'usr_a', 'Alice', T0 + MINUTE)
    person('OnPlayerLeft', 'usr_a', 'Alice', T0 + 9 * MINUTE)
    room('wrld_bbbb:1', T0 + 60 * MINUTE, 5 * MINUTE, 'Next')

    await importVrcxHistory(options())
    const saved = visits()
    expect(saved.map((visit) => [visit.worldName, visit.leftAt])).toEqual([
      ['Next', T0 + 65 * MINUTE],
      ['The Room', T0 + 9 * MINUTE]
    ])
  })

  it('adds nothing twice, and leaves a room VRX saved itself as it is', async () => {
    room(ROOM, T0, 30 * MINUTE)
    person('OnPlayerJoined', 'usr_a', 'Alice', T0 + MINUTE)
    person('OnPlayerLeft', 'usr_a', 'Alice', T0 + 11 * MINUTE)
    // VRX read the same stay from the game's own log, a few seconds apart.
    room('wrld_bbbb:1', T0 + 60 * MINUTE, 5 * MINUTE, 'Seen by both')
    person('OnPlayerJoined', 'usr_a', 'Alice', T0 + 61 * MINUTE, 0, 'wrld_bbbb:1')
    const own = database.openVisit(KEY, {
      instanceId: 'wrld_bbbb:1',
      worldName: 'Seen by both',
      enteredAt: T0 + 60 * MINUTE + 2_000
    })
    database.encounterJoined(KEY, own ?? 0, {
      platformUserId: 'usr_a',
      displayName: 'Alice',
      at: T0 + 61 * MINUTE + 2_000
    })

    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, visits: 1 })
    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, visits: 0 })
    expect(visits()).toHaveLength(2)
    expect(database.metFacts(KEY, 'usr_a')).toMatchObject({ times: 2 })
    expect(database.visitPeople(KEY, own ?? 0, 10)).toHaveLength(1)
  })

  it('leaves out rooms older than the Keep for choice and says so', async () => {
    room(ROOM, T0, 30 * MINUTE, 'Old')
    person('OnPlayerJoined', 'usr_a', 'Alice', T0 + MINUTE)
    room('wrld_bbbb:1', T0 + 600 * MINUTE, 5 * MINUTE, 'New')
    cutoff = T0 + 300 * MINUTE

    await expect(importVrcxHistory(options())).resolves.toMatchObject({
      ok: true,
      visits: 1,
      olderSkipped: true
    })
    expect(visits().map((visit) => visit.worldName)).toEqual(['New'])
    expect(database.metFacts(KEY, 'usr_a')).toBeNull()
  })

  it('keeps only the newest rooms beyond the limit', async () => {
    for (let index = 0; index < 5; index += 1) {
      room(`wrld_cccc:${index}`, T0 + index * 10 * MINUTE, MINUTE, `Room ${index}`)
    }
    await expect(importVrcxHistory(options({ maxVisits: 2 }))).resolves.toMatchObject({
      ok: true,
      visits: 2,
      olderSkipped: true
    })
    expect(visits().map((visit) => visit.worldName)).toEqual(['Room 4', 'Room 3'])
  })

  it('stops when the account changes part way', async () => {
    bulk(() => {
      for (let index = 0; index < 2_500; index += 1) {
        room(`wrld_cccc:${index}`, T0 + index * MINUTE, 1_000)
      }
    })
    const result = await importVrcxHistory(
      options({
        pause: () => {
          accountKey = 'vrchat:usr_other'
          return Promise.resolve()
        }
      })
    )
    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(visits()).toEqual([])
  })

  it('finishes a run that stopped part way, without adding anything twice', async () => {
    const second = 'wrld_bbbb:1'
    bulk(() => {
      room(ROOM, T0, 10 * MINUTE)
      person('OnPlayerJoined', 'usr_a', 'Alice', T0 + MINUTE)
      person('OnPlayerLeft', 'usr_a', 'Alice', T0 + 5 * MINUTE)
      // More people than one step reads, so the run can stop inside this room.
      room(second, T0 + 60 * MINUTE, 600 * MINUTE, 'Crowded')
      for (let index = 0; index < 1_500; index += 1) {
        person('OnPlayerJoined', `usr_p${index}`, `P${index}`, T0 + 61 * MINUTE, 0, second)
        person('OnPlayerLeft', `usr_p${index}`, `P${index}`, T0 + 90 * MINUTE, 0, second)
      }
    })

    const stopped = await importVrcxHistory(
      options({
        pause: () => {
          accountKey = 'vrchat:usr_other'
          return Promise.resolve()
        }
      })
    )
    expect(stopped).toEqual({ ok: false, reason: 'failed' })
    // Only a whole room was saved: the one being read is not there at all.
    expect(visits().map((visit) => [visit.worldName, visit.people])).toEqual([['The Room', 1]])

    accountKey = KEY
    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, visits: 1 })
    expect(visits().map((visit) => [visit.worldName, visit.people])).toEqual([
      ['Crowded', 1_500],
      ['The Room', 1]
    ])
    await expect(importVrcxHistory(options())).resolves.toMatchObject({ ok: true, visits: 0 })
    expect(visits()).toHaveLength(2)
  })

  it('reads only tables shaped the way VRCX writes them', async () => {
    room(ROOM, T0, MINUTE)
    vrcx.exec('DROP TABLE gamelog_join_leave')
    vrcx.exec('ALTER TABLE gamelog_location RENAME TO rooms')
    vrcx.exec('CREATE VIEW gamelog_location AS SELECT * FROM rooms')
    await expect(importVrcxHistory(options())).resolves.toEqual({
      ok: true,
      friendsSince: 0,
      names: 0,
      visits: 0,
      olderSkipped: false
    })

    vrcx.exec(`DROP TABLE ${PREFIX}_friend_log_history`)
    vrcx.exec(`CREATE TABLE ${PREFIX}_friend_log_history (id INTEGER PRIMARY KEY, other TEXT)`)
    await expect(importVrcxHistory(options())).resolves.toEqual({
      ok: false,
      reason: 'no-history'
    })
  })
})
