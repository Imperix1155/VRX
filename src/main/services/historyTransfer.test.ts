import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_FILE_NAME, HISTORY_SCHEMA_VERSION, HistoryDatabase } from './historyDatabase'
import {
  backUpHistory,
  historyBackupFileName,
  restoreHistory,
  type HistoryTransferOptions
} from './historyTransfer'

const VRC = 'vrchat:usr_me'
const CVR = 'chilloutvr:me-1'

let dir: string
let work: string
let keeping: boolean
const open: HistoryDatabase[] = []

function database(name: string): HistoryDatabase {
  const created = new HistoryDatabase({ path: join(dir, name, HISTORY_FILE_NAME) })
  open.push(created)
  return created
}

function transfer(
  target: HistoryDatabase,
  afterRestore = vi.fn()
): HistoryTransferOptions & { afterRestore: ReturnType<typeof vi.fn> } {
  return {
    database: target,
    isKeeping: () => keeping,
    workDirectory: () => work,
    afterRestore
  }
}

/** One of everything, under both platforms' accounts. */
function fill(target: HistoryDatabase): void {
  target.insertActivity({
    id: 7,
    accountKey: VRC,
    kind: 'online',
    platformUserId: 'usr_a',
    displayName: 'Alice',
    worldName: 'Home',
    previousName: null,
    at: 1_000
  })
  target.saveFriends(CVR, [
    { platformUserId: 'c-1', displayName: 'Cy', since: 500, sinceKnown: true, misses: 1 }
  ])
  target.insertNameChange(CVR, 'c-1', 'Cyrus', 900)
  const visit = target.openVisit(VRC, { instanceId: 'wrld_a:1', worldName: 'Home', enteredAt: 100 })
  target.encounterJoined(VRC, visit ?? 0, {
    platformUserId: 'usr_a',
    displayName: 'Alice',
    at: 150
  })
  target.closeVisit(visit ?? 0, 400)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vrx-history-transfer-'))
  work = join(dir, 'work')
  mkdirSync(work)
  for (const name of ['old-pc', 'new-pc', 'pc']) mkdirSync(join(dir, name))
  keeping = true
})

afterEach(() => {
  for (const created of open.splice(0)) created.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('history backup and restore', () => {
  it('names a backup by the day it was made', () => {
    expect(historyBackupFileName(new Date(2026, 10, 5, 9, 30))).toBe(
      'vrx-history-2026-11-05.sqlite3'
    )
  })

  it('moves everything to another computer', async () => {
    const oldPc = database('old-pc')
    fill(oldPc)
    const backup = join(dir, 'backup.sqlite3')
    await expect(backUpHistory(transfer(oldPc), backup)).resolves.toEqual({ ok: true })

    const newPc = database('new-pc')
    newPc.insertActivity({
      id: 3,
      accountKey: VRC,
      kind: 'offline',
      platformUserId: 'usr_z',
      displayName: 'Replaced',
      worldName: null,
      previousName: null,
      at: 5
    })
    const options = transfer(newPc)
    await expect(restoreHistory(options, backup)).resolves.toEqual({ ok: true })
    expect(options.afterRestore).toHaveBeenCalledTimes(1)

    expect(newPc.recentActivity(VRC, 10).map((row) => [row.id, row.displayName])).toEqual([
      [7, 'Alice']
    ])
    expect(newPc.savedFriend(CVR, 'c-1')).toEqual({
      platformUserId: 'c-1',
      displayName: 'Cy',
      since: 500,
      sinceKnown: true,
      misses: 1
    })
    expect(newPc.nameChanges(CVR, 'c-1', 5)).toEqual([{ previousName: 'Cyrus', at: 900 }])
    expect(newPc.metFacts(VRC, 'usr_a')).toEqual({
      times: 1,
      togetherMs: 250,
      lastAt: 400,
      lastWorldName: 'Home'
    })
    // The working copies are gone, and the backup is as it was written.
    expect(readdirSync(work)).toEqual([])
    expect(existsSync(`${backup}-wal`)).toBe(false)
    expect(existsSync(`${backup}-journal`)).toBe(false)
  })

  it('replaces a backup file already at that path', async () => {
    const source = database('old-pc')
    fill(source)
    const backup = join(dir, 'backup.sqlite3')
    writeFileSync(backup, 'an older file')
    await expect(backUpHistory(transfer(source), backup)).resolves.toEqual({ ok: true })
    const check = new DatabaseSync(backup, { readOnly: true })
    expect(check.prepare('SELECT COUNT(*) AS rows FROM activity').get()).toEqual({ rows: 1 })
    check.close()
  })

  it('does nothing while history is not kept', async () => {
    const target = database('pc')
    keeping = false
    const options = transfer(target)
    await expect(backUpHistory(options, join(dir, 'b.sqlite3'))).resolves.toEqual({
      ok: false,
      reason: 'off'
    })
    await expect(restoreHistory(options, join(dir, 'b.sqlite3'))).resolves.toEqual({
      ok: false,
      reason: 'off'
    })
    expect(existsSync(join(dir, 'b.sqlite3'))).toBe(false)
  })

  it('writes no backup once history stopped being kept while it waited', async () => {
    const source = database('old-pc')
    fill(source)
    const backup = join(dir, 'b.sqlite3')
    const options = transfer(source)
    // The setting changes after the first check, before the copy is written.
    options.workDirectory = () => {
      keeping = false
      return work
    }
    await expect(backUpHistory(options, backup)).resolves.toEqual({ ok: false, reason: 'off' })
    expect(existsSync(backup)).toBe(false)
    expect(readdirSync(work)).toEqual([])
  })

  it('restores nothing once history stopped being kept while it waited', async () => {
    const oldPc = database('old-pc')
    fill(oldPc)
    const backup = join(dir, 'backup.sqlite3')
    await expect(backUpHistory(transfer(oldPc), backup)).resolves.toEqual({ ok: true })

    const target = database('pc')
    const options = transfer(target)
    options.workDirectory = () => {
      keeping = false
      return work
    }
    await expect(restoreHistory(options, backup)).resolves.toEqual({ ok: false, reason: 'off' })
    expect(options.afterRestore).not.toHaveBeenCalled()
    expect(target.recentActivity(VRC, 10)).toEqual([])
  })

  it('refuses a file that is not a backup and keeps what is saved', async () => {
    const target = database('pc')
    fill(target)
    const options = transfer(target)

    const text = join(dir, 'notes.sqlite3')
    writeFileSync(text, 'not a database at all, just some words')
    await expect(restoreHistory(options, text)).resolves.toEqual({
      ok: false,
      reason: 'not-a-backup'
    })

    const other = join(dir, 'other.sqlite3')
    const otherDb = new DatabaseSync(other)
    otherDb.exec('CREATE TABLE activity (id INTEGER PRIMARY KEY); PRAGMA user_version = 1')
    otherDb.close()
    await expect(restoreHistory(options, other)).resolves.toEqual({
      ok: false,
      reason: 'not-a-backup'
    })

    await expect(restoreHistory(options, join(dir, 'missing.sqlite3'))).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(options.afterRestore).not.toHaveBeenCalled()
    expect(target.recentActivity(VRC, 10)).toHaveLength(1)
    expect(target.metFacts(VRC, 'usr_a')).not.toBeNull()
  })

  it('refuses a backup from a newer version', async () => {
    const source = database('old-pc')
    fill(source)
    const backup = join(dir, 'backup.sqlite3')
    await backUpHistory(transfer(source), backup)
    const newer = new DatabaseSync(backup)
    newer.exec(`PRAGMA user_version = ${HISTORY_SCHEMA_VERSION + 1}`)
    newer.close()

    const target = database('new-pc')
    await expect(restoreHistory(transfer(target), backup)).resolves.toEqual({
      ok: false,
      reason: 'newer'
    })
  })

  it('lands whole or not at all', async () => {
    const source = database('old-pc')
    fill(source)
    const backup = join(dir, 'backup.sqlite3')
    await backUpHistory(transfer(source), backup)
    // A table with the right name and the wrong columns fails part way.
    const broken = new DatabaseSync(backup)
    broken.exec('DROP TABLE encounters; CREATE TABLE encounters (id INTEGER PRIMARY KEY)')
    broken.close()

    const target = database('new-pc')
    fill(target)
    target.insertNameChange(CVR, 'c-1', 'Kept', 950)
    await expect(restoreHistory(transfer(target), backup)).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(target.nameChanges(CVR, 'c-1', 5).map((change) => change.previousName)).toEqual([
      'Kept',
      'Cyrus'
    ])
    // And the database still works afterwards.
    expect(target.recentActivity(VRC, 10)).toHaveLength(1)
  })

  it('brings back when each instance log was last cleared, never a later moment', async () => {
    const source = database('old-pc')
    fill(source)
    source.deleteInstanceLog(VRC, 5_000)
    const backup = join(dir, 'backup.sqlite3')
    await backUpHistory(transfer(source), backup)

    // This computer cleared its own log at another moment; the backup wins.
    const target = database('new-pc')
    target.deleteInstanceLog(CVR, 9_000)
    await expect(restoreHistory(transfer(target), backup)).resolves.toEqual({ ok: true })
    expect(target.instanceLogFloor(VRC)).toBe(5_000)
    expect(target.instanceLogFloor(CVR)).toBe(0)

    // A backup that claims a moment still to come cannot stop the log.
    const edited = new DatabaseSync(backup)
    edited
      .prepare('UPDATE instance_log_floor SET at = ? WHERE account_key = ?')
      .run(Date.now() + 86_400_000 * 365, VRC)
    edited.close()
    const before = Date.now()
    await expect(restoreHistory(transfer(target), backup)).resolves.toEqual({ ok: true })
    expect(target.instanceLogFloor(VRC)).toBeGreaterThanOrEqual(before)
    expect(target.instanceLogFloor(VRC)).toBeLessThanOrEqual(Date.now())

    // A backup made before that table existed restores as before.
    const older = new DatabaseSync(backup)
    older.exec('DROP TABLE instance_log_floor')
    older.close()
    await expect(restoreHistory(transfer(target), backup)).resolves.toEqual({ ok: true })
    expect(target.instanceLogFloor(VRC)).toBe(0)
  })
})
