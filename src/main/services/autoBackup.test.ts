/**
 * Scheduled local backups. These tests drive the service the way the app
 * does: a real history file, a temp data folder, and the same backupTo path
 * a manual backup uses.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSettings } from '@shared/settings'
import type { AutoBackupInterval } from '@shared/autoBackup'
import type { HistoryRestoreResult } from '@shared/historyTransfer'
import { HISTORY_FILE_NAME, HistoryDatabase } from './historyDatabase'
import { restoreHistory, type HistoryTransferOptions } from './historyTransfer'
import { createAutoBackup, type AutoBackup, type AutoBackupOptions } from './autoBackup'

const ACCOUNT = 'vrchat:usr_me'
const DAY = 24 * 60 * 60 * 1000
const SECRET = 'sentinel-secret-do-not-copy'

let root: string
let userData: string
let work: string
let database: HistoryDatabase
let keeping: boolean
let autoBackup: boolean
let autoBackupInterval: AutoBackupInterval
let autoBackupKeep: number
let now: number
const open: HistoryDatabase[] = []

function row(
  id: number,
  displayName: string
): {
  id: number
  accountKey: string
  kind: 'online'
  platformUserId: string
  displayName: string
  worldName: null
  previousName: null
  at: number
} {
  return {
    id,
    accountKey: ACCOUNT,
    kind: 'online' as const,
    platformUserId: 'usr_a',
    displayName,
    worldName: null,
    previousName: null,
    at: id
  }
}

function namesIn(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return (
      db.prepare('SELECT display_name FROM activity ORDER BY id').all() as Array<{
        display_name?: unknown
      }>
    ).map((entry) => String(entry.display_name))
  } finally {
    db.close()
  }
}

function liveNames(): string[] {
  return database.recentActivity(ACCOUNT, 10).map((entry) => entry.displayName)
}

function backupFolder(): string {
  return join(userData, 'backups')
}

function backupNames(): string[] {
  if (!existsSync(backupFolder())) return []
  return readdirSync(backupFolder())
    .filter((name) => /^vrx-backup-\d{8}T\d{9}Z$/.test(name))
    .sort()
}

function realSnapshot(dest: string): 'saved' | 'failed' | 'stopped' {
  return database.job(() => keeping && database.storage === 'file').backupTo(dest)
}

function service(overrides: Partial<AutoBackupOptions> = {}): AutoBackup {
  const transfer: HistoryTransferOptions = {
    database,
    isKeeping: () => keeping,
    workDirectory: () => work,
    afterRestore: () => undefined
  }
  return createAutoBackup({
    userDataDir: () => userData,
    snapshotHistory: realSnapshot,
    historyIsFile: () => database.storage === 'file',
    settings: () => ({ autoBackup, autoBackupInterval, autoBackupKeep }),
    now: () => now,
    restoreHistory: (source) => restoreHistory(transfer, source),
    log: () => undefined,
    ...overrides
  })
}

/** Break an index so PRAGMA integrity_check opens and reports a problem. */
function spoilIntegrity(file: string): void {
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE spoil(id INTEGER PRIMARY KEY, y TEXT)')
  db.exec('CREATE INDEX spoil_y ON spoil(y)')
  db.prepare('INSERT INTO spoil(y) VALUES (?)').run('SENTINELROW0')
  db.close()
  const bytes = readFileSync(file)
  const at = bytes.indexOf('SENTINELROW0')
  const byte = bytes[at]
  if (at < 0 || byte === undefined) throw new Error('indexed row missing')
  bytes[at] = byte ^ 0xff
  writeFileSync(file, bytes)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vrx-auto-backup-'))
  userData = join(root, 'user')
  work = join(root, 'work')
  mkdirSync(userData)
  mkdirSync(work)
  database = new HistoryDatabase({ path: join(userData, HISTORY_FILE_NAME) })
  open.push(database)
  keeping = true
  autoBackup = false
  autoBackupInterval = 'daily'
  autoBackupKeep = 5
  now = Date.UTC(2026, 10, 25, 5, 33, 1, 123)
})

afterEach(() => {
  for (const created of open.splice(0)) created.close()
  rmSync(root, { recursive: true, force: true })
})

describe('scheduled local backups', () => {
  it('does nothing while automatic backup is off', async () => {
    expect(parseSettings({}).autoBackup).toBe(false)
    autoBackup = parseSettings({}).autoBackup
    await service().check()
    expect(existsSync(backupFolder())).toBe(false)
    expect(existsSync(join(userData, 'auto-backup.json'))).toBe(false)
  })

  it('writes a backup when one is due and skips one that is still fresh', async () => {
    autoBackup = true
    const backups = service()
    await backups.check()
    expect(backupNames()).toHaveLength(1)
    const first = backupNames()[0]
    now += 60 * 60 * 1000
    await backups.check()
    expect(backupNames()).toEqual([first])

    autoBackupInterval = 'weekly'
    now += 8 * DAY
    await backups.check()
    expect(backupNames()).toHaveLength(2)
    expect(backupNames()).toContain(first)
  })

  it('snapshots history through the database, not by copying the live file', async () => {
    database.insertActivity(row(1, 'Kept'))
    const live = join(userData, HISTORY_FILE_NAME)
    renameSync(live, `${live}.held`)
    writeFileSync(live, 'SENTINEL-NOT-A-DATABASE')
    autoBackup = true
    await service().check()

    expect(readFileSync(live, 'utf8')).toBe('SENTINEL-NOT-A-DATABASE')
    const copy = join(backupFolder(), backupNames()[0] ?? '', HISTORY_FILE_NAME)
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
      expect(db.prepare('SELECT display_name FROM activity').all()).toEqual([
        { display_name: 'Kept' }
      ])
    } finally {
      db.close()
    }
    expect(readFileSync(copy).includes('SENTINEL-NOT-A-DATABASE')).toBe(false)
  })

  it('keeps the newest copies and leaves a credential file in the folder alone', async () => {
    autoBackup = true
    autoBackupKeep = 5
    const backups = service()
    const stamped: number[] = []
    for (let index = 0; index < 7; index += 1) {
      await backups.check()
      stamped.push(now)
      if (index === 0)
        writeFileSync(join(backupFolder(), 'credentials.json'), 'credential-bytes-stay')
      now += DAY
    }
    const names = backupNames()
    expect(names).toHaveLength(5)
    const status = await backups.status()
    expect(status.copies.map((copy) => copy.createdAt)).toEqual([...stamped].slice(-5).reverse())
    expect(names.every((name) => status.copies.some((copy) => copy.id === name))).toBe(true)
    expect(readFileSync(join(backupFolder(), 'credentials.json'), 'utf8')).toBe(
      'credential-bytes-stay'
    )
  })

  it('leaves secrets out of the copy', async () => {
    writeFileSync(join(userData, 'credentials.json'), SECRET)
    writeFileSync(join(userData, 'credential-owners.json'), SECRET)
    mkdirSync(join(userData, 'credential-storage'))
    writeFileSync(join(userData, 'credential-storage', 'key-v1'), SECRET)
    writeFileSync(join(userData, 'Cookies'), SECRET)
    symlinkSync(join(userData, 'credentials.json'), join(userData, 'settings.json'))
    const social = Buffer.from('{"notes":"ada"}')
    const links = Buffer.from('{"people":"ada"}')
    writeFileSync(join(userData, 'social.json'), social)
    writeFileSync(join(userData, 'link-graph.json'), links)
    writeFileSync(join(userData, 'auto-backup.json'), '{"directory":null}')
    autoBackup = true
    await service().check()

    const dir = join(backupFolder(), backupNames()[0] ?? '')
    const names = readdirSync(dir)
    expect(names).toEqual(
      expect.arrayContaining(['social.json', 'link-graph.json', 'manifest.json'])
    )
    expect(names).not.toContain('credentials.json')
    expect(names).not.toContain('credential-owners.json')
    expect(names).not.toContain('credential-storage')
    expect(names).not.toContain('Cookies')
    expect(names).not.toContain('key-v1')
    expect(names).not.toContain('settings.json')
    expect(names).not.toContain('auto-backup.json')
    expect(readFileSync(join(dir, 'social.json'))).toEqual(social)
    expect(readFileSync(join(dir, 'link-graph.json'))).toEqual(links)
    for (const name of names) {
      const file = join(dir, name)
      expect(statSync(file).isFile()).toBe(true)
      expect(readFileSync(file).includes(SECRET)).toBe(false)
    }
  })

  it('restores history from a scheduled backup and keeps the replaced rows aside', async () => {
    database.insertActivity(row(1, 'Original'))
    autoBackup = true
    const backups = service()
    await backups.check()
    database.insertActivity(row(2, 'Replacement'))
    const id = (await backups.status()).copies[0]?.id ?? ''
    await expect(backups.restore(id)).resolves.toEqual({ ok: true })
    expect(liveNames()).toEqual(['Original'])

    const safety = readdirSync(backupFolder()).filter((name) =>
      /^vrx-safety-\d{8}T\d{9}Z$/.test(name)
    )
    expect(safety).toHaveLength(1)
    expect(namesIn(join(backupFolder(), safety[0] ?? '', HISTORY_FILE_NAME))).toContain(
      'Replacement'
    )

    const after = liveNames()
    await expect(backups.restore(`..${sep}credentials.json`)).resolves.toEqual({
      ok: false,
      reason: 'unknown'
    })
    await expect(backups.restore('vrx-backup-nope')).resolves.toEqual({
      ok: false,
      reason: 'unknown'
    })
    expect(liveNames()).toEqual(after)
  })

  it('does not restore when the safety copy fails', async () => {
    database.insertActivity(row(1, 'Original'))
    autoBackup = true
    const restore = vi.fn((source: string): Promise<HistoryRestoreResult> =>
      restoreHistory(
        {
          database,
          isKeeping: () => keeping,
          workDirectory: () => work,
          afterRestore: () => undefined
        },
        source
      )
    )
    const backups = service({
      snapshotHistory: (dest) =>
        dest.includes(`${sep}vrx-safety-`) ? 'failed' : realSnapshot(dest),
      restoreHistory: restore
    })
    await backups.check()
    database.insertActivity(row(2, 'Replacement'))
    const id = (await backups.status()).copies[0]?.id ?? ''
    await expect(backups.restore(id)).resolves.toEqual({ ok: false, reason: 'failed' })
    expect(restore).not.toHaveBeenCalled()
    expect(liveNames()).toEqual(['Replacement', 'Original'])
  })

  it('records a failed snapshot and discards a copy that does not check out', async () => {
    autoBackup = true
    const failed = service({ snapshotHistory: () => 'failed' })
    await failed.check()
    expect(backupNames()).toEqual([])
    expect(await failed.status()).toMatchObject({ lastError: 'failed', copies: [] })
    expect(readdirSync(backupFolder()).some((name) => name.endsWith('.partial'))).toBe(false)

    const spoiled = service({
      snapshotHistory: (dest) => {
        const saved = realSnapshot(dest)
        if (saved !== 'saved') return saved
        spoilIntegrity(dest)
        return 'saved'
      }
    })
    await spoiled.check()
    expect(backupNames()).toEqual([])
    expect((await spoiled.status()).lastError).toBe('integrity')
  })
})
