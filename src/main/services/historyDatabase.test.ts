import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_FILE_NAME,
  HISTORY_SCHEMA_VERSION,
  HistoryDatabase,
  platformOfAccountKey,
  toActivityEntry,
  type SavedActivityRow
} from './historyDatabase'

const VRC = 'vrchat:usr_me'
const CVR = 'chilloutvr:me-1'

function row(id: number, overrides: Partial<SavedActivityRow> = {}): SavedActivityRow {
  return {
    id,
    accountKey: VRC,
    kind: 'online',
    platformUserId: 'usr_a',
    displayName: 'Alice',
    worldName: null,
    at: 1_000 + id,
    ...overrides
  }
}

let dir: string
let path: string
const open: HistoryDatabase[] = []

function database(log = vi.fn()): HistoryDatabase {
  const created = new HistoryDatabase({ path, now: () => 42, log })
  open.push(created)
  return created
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vrx-history-'))
  path = join(dir, HISTORY_FILE_NAME)
})

afterEach(() => {
  for (const created of open.splice(0)) created.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('HistoryDatabase', () => {
  it('saves entries to the file and reads them back after a restart', () => {
    const first = database()
    expect(first.storage).toBe('file')
    expect(first.maxActivityId()).toBe(0)
    expect(first.insertActivity(row(1))).toBe(true)
    expect(first.insertActivity(row(2, { kind: 'world', worldName: 'Pug Lounge' }))).toBe(true)
    first.close()

    const second = database()
    expect(second.storage).toBe('file')
    expect(second.maxActivityId()).toBe(2)
    expect(second.recentActivity(VRC, 10)).toEqual([
      row(2, { kind: 'world', worldName: 'Pug Lounge' }),
      row(1)
    ])
  })

  it('keeps each account to its own rows', () => {
    const db = database()
    db.insertActivity(row(1))
    db.insertActivity(row(2, { accountKey: CVR, platformUserId: 'friend-1' }))
    db.insertActivity(row(3, { accountKey: 'vrchat:usr_other' }))

    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([1])
    expect(db.recentActivity(CVR, 10).map((entry) => entry.id)).toEqual([2])
    expect(
      db
        .pageActivity({
          accounts: [
            { accountKey: VRC, beforeId: null },
            { accountKey: CVR, beforeId: null }
          ],
          kind: null,
          friends: null,
          limit: 10
        })
        .map((entry) => entry.id)
    ).toEqual([2, 1])
    expect(db.pageActivity({ accounts: [], kind: null, friends: null, limit: 10 })).toEqual([])
  })

  it('pages by id, kind and friend', () => {
    const db = database()
    for (let id = 1; id <= 6; id++) {
      db.insertActivity(
        row(id, {
          kind: id % 2 === 0 ? 'offline' : 'online',
          platformUserId: id <= 3 ? 'usr_a' : 'usr_b'
        })
      )
    }
    const page = (query: Partial<Parameters<HistoryDatabase['pageActivity']>[0]>): number[] =>
      db
        .pageActivity({
          accounts: [{ accountKey: VRC, beforeId: null }],
          kind: null,
          friends: null,
          limit: 10,
          ...query
        })
        .map((entry) => entry.id)

    expect(page({ accounts: [{ accountKey: VRC, beforeId: 4 }] })).toEqual([3, 2, 1])
    expect(page({ kind: 'offline' })).toEqual([6, 4, 2])
    expect(page({ limit: 2 })).toEqual([6, 5])
    expect(page({ friends: [{ accountKey: VRC, platformUserId: 'usr_b' }] })).toEqual([6, 5, 4])
    // The same friend id under another account is someone else's row.
    expect(page({ friends: [{ accountKey: CVR, platformUserId: 'usr_b' }] })).toEqual([])
    expect(page({ friends: [] })).toEqual([])
  })

  it('continues each account from its own place', () => {
    const db = database()
    for (let id = 1; id <= 8; id++) {
      db.insertActivity(row(id, { accountKey: id % 2 === 0 ? CVR : VRC }))
    }
    expect(
      db
        .pageActivity({
          accounts: [
            { accountKey: VRC, beforeId: 7 },
            { accountKey: CVR, beforeId: 4 }
          ],
          kind: null,
          friends: null,
          limit: 10
        })
        .map((entry) => entry.id)
    ).toEqual([5, 3, 2, 1])
  })

  it('never saves an id twice and fills a world name only once', () => {
    const db = database()
    db.insertActivity(row(1, { kind: 'world' }))
    db.insertActivity(row(1, { displayName: 'Someone else' }))
    db.setActivityWorldName(1, 'Night Market')
    db.setActivityWorldName(1, 'Changed later')

    expect(db.recentActivity(VRC, 10)).toEqual([
      row(1, { kind: 'world', worldName: 'Night Market' })
    ])
  })

  it('forgets one account by kind, by account, or everything', () => {
    const db = database()
    db.insertActivity(row(1))
    db.insertActivity(row(2, { kind: 'offline' }))
    db.insertActivity(row(3, { accountKey: CVR }))

    db.deleteActivity(VRC, 'offline')
    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([1])
    db.deleteActivity(VRC, null)
    expect(db.recentActivity(VRC, 10)).toEqual([])
    expect(db.recentActivity(CVR, 10).map((entry) => entry.id)).toEqual([3])
    db.deleteAllActivity()
    expect(db.recentActivity(CVR, 10)).toEqual([])
  })

  it('removes entries past the age limit and beyond the row limit', () => {
    const db = database()
    for (let id = 1; id <= 5; id++) db.insertActivity(row(id, { at: id * 100 }))

    db.pruneActivity(250, 1_000)
    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([5, 4, 3])
    db.pruneActivity(null, 2)
    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([5, 4])
    db.pruneActivity(null, 2)
    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([5, 4])
  })

  it('sets a damaged file aside, never deletes it, and starts a new one', () => {
    writeFileSync(path, 'this is not a database, it is a damaged file '.repeat(200))
    const log = vi.fn()
    const db = database(log)

    expect(db.storage).toBe('file')
    expect(db.insertActivity(row(1))).toBe(true)
    expect(readdirSync(dir)).toContain('history.corrupt-42.sqlite3')
    expect(log).toHaveBeenCalledWith('history file was damaged; started a new one')
    db.close()
    expect(
      database()
        .recentActivity(VRC, 10)
        .map((entry) => entry.id)
    ).toEqual([1])
  })

  it('leaves a file from a newer version untouched and saves nothing', () => {
    const newer = new DatabaseSync(path)
    newer.exec(
      `CREATE TABLE future (id INTEGER); PRAGMA user_version = ${HISTORY_SCHEMA_VERSION + 1}`
    )
    newer.close()
    const log = vi.fn()

    const db = database(log)
    expect(db.storage).toBe('memory-newer-file')
    // The session still works, in memory.
    expect(db.insertActivity(row(1))).toBe(true)
    expect(db.recentActivity(VRC, 10).map((entry) => entry.id)).toEqual([1])
    db.close()

    expect(readdirSync(dir).filter((name) => name.includes('corrupt'))).toEqual([])
    const check = new DatabaseSync(path)
    expect(check.prepare('PRAGMA user_version').get()).toEqual({
      user_version: HISTORY_SCHEMA_VERSION + 1
    })
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'activity'").get()).toBe(
      undefined
    )
    check.close()
  })

  it('runs in memory when the folder cannot be used', () => {
    path = join(dir, 'missing-folder', HISTORY_FILE_NAME)
    const log = vi.fn()
    const db = database(log)

    expect(db.storage).toBe('memory-unavailable')
    expect(db.insertActivity(row(1))).toBe(true)
    expect(db.maxActivityId()).toBe(1)
    expect(log).toHaveBeenCalledWith('history file is unavailable; saving is off for this session')
  })

  it('skips rows that are not usable instead of failing the read', () => {
    const db = database()
    db.insertActivity(row(1))
    db.close()
    const raw = new DatabaseSync(path)
    raw.exec(`
      INSERT INTO activity (id, account_key, kind, user_id, display_name, world_name, at)
      VALUES (2, '${VRC}', 'made-up', 'usr_a', 'Alice', NULL, 5),
             (3, '${VRC}', 'online', '', 'Alice', NULL, 5),
             (4, '${VRC}', 'online', 'usr_a', 'Alice', '', 5)
    `)
    raw.close()

    expect(database().recentActivity(VRC, 10)).toEqual([row(4, { at: 5 }), row(1)])
  })

  it('answers quietly after it is closed', () => {
    const log = vi.fn()
    const db = database(log)
    db.close()
    db.close()

    expect(db.insertActivity(row(1))).toBe(false)
    expect(db.recentActivity(VRC, 10)).toEqual([])
    expect(db.maxActivityId()).toBe(0)
    expect(() => db.pruneActivity(1, 1)).not.toThrow()
  })

  it('logs nothing about the rows it handles', () => {
    writeFileSync(path, 'damaged')
    const log = vi.fn()
    const db = database(log)
    db.insertActivity(row(1, { displayName: 'Private Name', worldName: 'Private World' }))

    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|usr_/)
  })
})

describe('account keys', () => {
  it('reads the platform from an account key and refuses unknown ones', () => {
    expect(platformOfAccountKey(VRC)).toBe('vrchat')
    expect(platformOfAccountKey(CVR)).toBe('chilloutvr')
    expect(platformOfAccountKey('other:1')).toBeNull()
    expect(toActivityEntry(row(1, { accountKey: 'other:1' }))).toBeNull()
    expect(toActivityEntry(row(1))).toEqual({
      id: 1,
      kind: 'online',
      platform: 'vrchat',
      platformUserId: 'usr_a',
      displayName: 'Alice',
      worldName: null,
      at: 1_001
    })
  })
})
