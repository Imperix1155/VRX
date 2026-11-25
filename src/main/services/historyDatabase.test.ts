import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { activityLikePattern } from '@shared/activity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_FILE_NAME,
  HISTORY_SCHEMA_VERSION,
  HistoryDatabase,
  platformOfAccountKey,
  toActivityEntry,
  type ActivityPageQuery,
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
    previousName: null,
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
          kinds: null,
          friends: null,
          limit: 10
        })
        .map((entry) => entry.id)
    ).toEqual([2, 1])
    expect(db.pageActivity({ accounts: [], kinds: null, friends: null, limit: 10 })).toEqual([])
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
          kinds: null,
          friends: null,
          limit: 10,
          ...query
        })
        .map((entry) => entry.id)

    expect(page({ accounts: [{ accountKey: VRC, beforeId: 4 }] })).toEqual([3, 2, 1])
    expect(page({ kinds: ['offline'] })).toEqual([6, 4, 2])
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
          kinds: null,
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

    db.deleteActivity(VRC, ['offline'])
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

describe('the writes of a job that waits (HistoryDatabase.job)', () => {
  const friendOf = (db: HistoryDatabase): ReturnType<HistoryDatabase['savedFriend']> =>
    db.savedFriend(VRC, 'usr_a')
  const visit = { instanceId: 'wrld_a:1', worldName: 'Home', enteredAt: 100, leftAt: 400 }
  const stay = { platformUserId: 'usr_a', displayName: 'Alice', joinedAt: 150, leftAt: 300 }

  function withFriend(): HistoryDatabase {
    const db = database()
    db.saveFriends(VRC, [
      { platformUserId: 'usr_a', displayName: 'Alice', since: 900, sinceKnown: false, misses: 0 }
    ])
    return db
  }

  it('writes while the job holds', () => {
    const db = withFriend()
    const writes = db.job(() => true)
    let ran = false
    expect(
      writes.batch(() => {
        ran = true
        expect(writes.importFriendSince(VRC, 'usr_a', 500)).toBe(true)
        expect(writes.importNameChange(VRC, 'usr_a', 'Al', 450)).toBe(true)
        expect(writes.importVisit(VRC, visit, [stay])).toBe(true)
      })
    ).toBe(true)
    expect(ran).toBe(true)
    expect(friendOf(db)).toMatchObject({ since: 500, sinceKnown: true })
    expect(db.nameChanges(VRC, 'usr_a', 5)).toEqual([{ previousName: 'Al', at: 450 }])
    expect(db.metFacts(VRC, 'usr_a')).toMatchObject({ times: 1 })
  })

  it('asks at every write, and writes nothing from the moment the answer is no', () => {
    const db = withFriend()
    let holds = true
    const writes = db.job(() => holds)
    expect(writes.importFriendSince(VRC, 'usr_a', 500)).toBe(true)

    holds = false
    let ran = false
    expect(writes.holds()).toBe(false)
    expect(writes.batch(() => (ran = true))).toBe(false)
    expect(ran).toBe(false)
    expect(writes.importFriendSince(VRC, 'usr_a', 100)).toBe(false)
    expect(writes.importNameChange(VRC, 'usr_a', 'Al', 450)).toBe(false)
    expect(writes.importVisit(VRC, visit, [stay])).toBe(false)
    const copy = join(dir, 'copy.sqlite3')
    expect(writes.backupTo(copy)).toBe('stopped')
    expect(writes.restoreFrom(copy)).toBe('stopped')

    expect(readdirSync(dir)).not.toContain('copy.sqlite3')
    expect(friendOf(db)).toMatchObject({ since: 500 })
    expect(db.nameChanges(VRC, 'usr_a', 5)).toEqual([])
    expect(db.metFacts(VRC, 'usr_a')).toBeNull()
  })

  it('stops part way through a batch when the answer changes inside it', () => {
    const db = withFriend()
    let holds = true
    const writes = db.job(() => holds)
    writes.batch(() => {
      expect(writes.importVisit(VRC, visit, [stay])).toBe(true)
      holds = false
      expect(writes.importVisit(VRC, { ...visit, enteredAt: 900_000, leftAt: 900_500 }, [])).toBe(
        false
      )
    })
    expect(db.pageVisits({ accounts: [{ accountKey: VRC, before: null }], limit: 5 })).toHaveLength(
      1
    )
  })

  it('offers these writes nowhere else', () => {
    // A job that waits must say what has to stay true. Each line below fails
    // the type check the day its write can be reached without doing so.
    const db = database()
    const direct = [
      // @ts-expect-error reachable only through job()
      db.importFriendSince,
      // @ts-expect-error reachable only through job()
      db.importNameChange,
      // @ts-expect-error reachable only through job()
      db.importVisit,
      // @ts-expect-error reachable only through job()
      db.backupTo,
      // @ts-expect-error reachable only through job()
      db.restoreFrom
    ]
    expect(direct).toHaveLength(5)
    expect(Object.keys(db.job(() => true)).sort()).toEqual([
      'backupTo',
      'batch',
      'holds',
      'importFriendSince',
      'importNameChange',
      'importVisit',
      'restoreFrom'
    ])
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

describe('activity search and dates', () => {
  const base = {
    accounts: [{ accountKey: VRC, beforeId: null }],
    kinds: null,
    friends: null,
    limit: 10
  } satisfies ActivityPageQuery

  function ids(db: HistoryDatabase, query: Partial<ActivityPageQuery> = {}): number[] {
    return db.pageActivity({ ...base, ...query }).map((entry) => entry.id)
  }

  it('matches a name, a world, a platform, a current name and an earlier name', () => {
    const db = database()
    db.insertActivity(row(1, { displayName: 'Alice', worldName: 'Night Market', at: 10 }))
    db.insertActivity(row(2, { displayName: 'Alice', kind: 'offline', at: 20 }))
    db.insertActivity(row(3, { displayName: 'Bob', platformUserId: 'usr_b', at: 30 }))
    db.insertActivity(
      row(4, { accountKey: CVR, displayName: 'Cara', platformUserId: 'friend-1', at: 40 })
    )
    const both = [
      { accountKey: VRC, beforeId: null },
      { accountKey: CVR, beforeId: null }
    ]
    db.saveFriends(VRC, [
      {
        platformUserId: 'usr_a',
        displayName: 'Robert',
        since: 1,
        sinceKnown: true,
        misses: 0
      }
    ])
    db.insertNameChange(VRC, 'usr_a', 'Carol', 5)

    expect(ids(db, { text: 'ali' })).toEqual([2, 1])
    expect(ids(db, { text: 'NIGHT' })).toEqual([1])
    expect(ids(db, { text: 'robert' })).toEqual([2, 1])
    expect(ids(db, { text: 'carol' })).toEqual([2, 1])
    expect(ids(db, { text: 'vrchat', accounts: both })).toEqual([3, 2, 1])
    expect(ids(db, { text: 'cvr', accounts: both })).toEqual([4])
    expect(ids(db, { text: '%' })).toEqual([])
    db.insertActivity(row(5, { displayName: '100%', platformUserId: 'usr_pct', at: 50 }))
    expect(ids(db, { text: '%' })).toEqual([5])
  })

  it('includes the first and last moment, and pages inside a kind', () => {
    const db = database()
    for (let id = 1; id <= 5; id++) {
      db.insertActivity(row(id, { displayName: 'Alice', kind: 'online', at: id * 100 }))
    }
    db.insertActivity(row(6, { displayName: 'Alice', kind: 'offline', at: 350 }))
    db.insertActivity(
      row(7, { displayName: 'Bob', platformUserId: 'usr_b', kind: 'online', at: 500 })
    )

    expect(ids(db, { from: 200, to: 400 })).toEqual([6, 4, 3, 2])
    expect(ids(db, { from: 200, to: 200 })).toEqual([2])
    expect(ids(db, { from: 201, to: 299 })).toEqual([])
    expect(ids(db, { text: 'alice', kinds: ['online'], limit: 2 })).toEqual([5, 4])
    expect(
      ids(db, {
        text: 'alice',
        kinds: ['online'],
        limit: 2,
        accounts: [{ accountKey: VRC, beforeId: 4 }]
      })
    ).toEqual([3, 2])
  })

  it('keeps an index on activity time and uses the account time index for a date window', () => {
    const created = database()
    created.close()
    const prepared = new DatabaseSync(path)
    prepared.exec('DROP INDEX IF EXISTS activity_by_account_time')
    prepared.exec('PRAGMA user_version = 1')
    prepared.close()

    database().close()
    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      expect(raw.prepare('PRAGMA user_version').get()).toEqual({
        user_version: HISTORY_SCHEMA_VERSION
      })
      const names = (
        raw
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'activity'`)
          .all() as Array<{
          name: string
        }>
      ).map((index) => index.name)
      expect(names).toContain('activity_by_time')
      expect(names).toContain('activity_by_account_time')
      const plan = raw
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM activity
           WHERE (account_key = ? OR account_key = ?) AND at >= ? AND at <= ?
           ORDER BY id DESC LIMIT ?`
        )
        .all(VRC, CVR, 1, 9_000, 100) as Array<{ detail: string }>
      expect(plan.map((step) => step.detail).join('\n')).toContain('activity_by_account_time')
    } finally {
      raw.close()
    }
  })

  it('gathers matching names once and searches 50,000 rows quickly', () => {
    const db = database()
    const rows = 50_000
    db.batch(() => {
      for (let id = 1; id <= rows; id += 1) {
        const other = id % 100 === 0
        db.insertActivity(
          row(id, {
            platformUserId: other ? 'usr_b' : 'usr_a',
            displayName: other ? 'Bea' : 'Ada',
            worldName: id === rows ? 'Night Market' : null,
            at: id
          })
        )
      }
    })
    db.insertNameChange(VRC, 'usr_a', 'Old Ada', 1)

    const search = (text: string): { ids: number[]; ms: number } => {
      const started = performance.now()
      const found = db.pageActivity({
        accounts: [{ accountKey: VRC, beforeId: null }],
        kinds: null,
        friends: null,
        limit: 10,
        text
      })
      return { ids: found.map((entry) => entry.id), ms: performance.now() - started }
    }
    const ada = search('ada')
    const earlier = search('old ada')
    const world = search('night')
    const miss = search('zzzz')
    expect(ada.ids).toHaveLength(10)
    expect(ada.ids[0]).toBe(rows - 1)
    expect(earlier.ids).toEqual(ada.ids)
    expect(world.ids).toEqual([rows])
    expect(miss.ids).toEqual([])
    expect(ada.ms, `name search ${ada.ms.toFixed(0)} ms`).toBeLessThan(2_000)
    expect(miss.ms, `miss search ${miss.ms.toFixed(0)} ms`).toBeLessThan(2_000)

    db.close()
    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      const pattern = activityLikePattern('ada')
      const plan = (
        raw
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT id FROM activity
             WHERE (account_key = ?)
               AND (
                 IFNULL(world_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR (CASE WHEN account_key LIKE 'chilloutvr:%' THEN 'chilloutvr cvr' ELSE 'vrchat vrc' END)
                   LIKE ? ESCAPE '\\' COLLATE NOCASE
                 OR (account_key, user_id) IN (
                   SELECT named.account_key, named.user_id FROM activity AS named
                   WHERE named.account_key IN (?)
                     AND (
                       named.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                       OR IFNULL(named.previous_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
                     )
                   UNION
                   SELECT roster.account_key, roster.user_id FROM friend_roster AS roster
                   WHERE roster.account_key IN (?)
                     AND roster.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                   UNION
                   SELECT earlier.account_key, earlier.user_id FROM friend_names AS earlier
                   WHERE earlier.account_key IN (?)
                     AND earlier.previous_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                 )
               )
             ORDER BY id DESC LIMIT ?`
          )
          .all(
            VRC,
            pattern,
            pattern,
            VRC,
            pattern,
            pattern,
            VRC,
            pattern,
            VRC,
            pattern,
            10
          ) as Array<{ detail: string }>
      )
        .map((step) => step.detail)
        .join('\n')
      expect(plan, plan).not.toContain('CORRELATED')
      expect(plan).toContain('LIST SUBQUERY')
    } finally {
      raw.close()
    }
  })

  it('matches an instance by world, person and the moment it started', () => {
    const db = database()
    const lounge = db.openVisit(VRC, {
      instanceId: 'wrld_1:1',
      worldName: 'Night Market',
      enteredAt: 1_000
    })
    const hall = db.openVisit(VRC, {
      instanceId: 'wrld_2:1',
      worldName: 'Quiet Hall',
      enteredAt: 2_000
    })
    expect(lounge).not.toBeNull()
    expect(hall).not.toBeNull()
    db.encounterJoined(VRC, lounge ?? 0, {
      platformUserId: 'usr_a',
      displayName: 'Alice',
      at: 1_000
    })
    const visits = (query: { text?: string; from?: number; to?: number }): string[] =>
      db
        .pageVisits({ accounts: [{ accountKey: VRC, before: null }], limit: 10, ...query })
        .map((visit) => visit.worldName ?? '')

    expect(visits({ text: 'night' })).toEqual(['Night Market'])
    expect(visits({ text: 'alice' })).toEqual(['Night Market'])
    expect(visits({ text: 'vrc' })).toEqual(['Quiet Hall', 'Night Market'])
    expect(visits({ from: 2_000, to: 2_000 })).toEqual(['Quiet Hall'])
    expect(visits({ from: 1_000, to: 1_000 })).toEqual(['Night Market'])
    expect(visits({ from: 1_001, to: 1_999 })).toEqual([])
  })
})
