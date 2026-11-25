/**
 * Scheduled local copies of this computer's VRX data (owner, 2026-11-25).
 * Off until the user turns it on. While VRX is open, a due check writes one
 * directory: a history snapshot from the database, plus the JSON files that
 * are really in the data folder. Nothing is uploaded, and a path stays here.
 */
import { constants, lstatSync, unlinkSync, type Dirent } from 'node:fs'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  AUTO_BACKUP_KEEP_DEFAULT,
  AUTO_BACKUP_KEEP_MAX,
  AUTO_BACKUP_KEEP_MIN,
  type AutoBackupFolderResult,
  type AutoBackupInterval,
  type AutoBackupProblem,
  type AutoBackupRestoreResult,
  type AutoBackupStatus
} from '@shared/autoBackup'
import type { HistoryRestoreResult } from '@shared/historyTransfer'

const HISTORY_FILE = 'history.sqlite3'
const JSON_FILES = ['settings.json', 'social.json', 'link-graph.json'] as const
const STATE_FILE = 'auto-backup.json'
const DEFAULT_FOLDER_NAME = 'backups'
const CHECK_EVERY_MS = 15 * 60 * 1000
const STAMP = String.raw`\d{8}T\d{9}Z`
const BACKUP_DIR = new RegExp(`^vrx-backup-${STAMP}$`)
const BACKUP_PARTIAL = new RegExp(`^vrx-backup-${STAMP}\\.partial$`)
const SAFETY_DIR = new RegExp(`^vrx-safety-${STAMP}$`)
const SAFETY_PARTIAL = new RegExp(`^vrx-safety-${STAMP}\\.partial$`)
const INTERVAL_MS: Record<AutoBackupInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  '3d': 72 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
}

export interface AutoBackupOptions {
  userDataDir: () => string
  /** The same `backupTo` a manual backup uses. It must not copy the live file. */
  snapshotHistory: (destinationPath: string) => 'saved' | 'failed' | 'stopped'
  historyIsFile: () => boolean
  settings: () => {
    autoBackup: boolean
    autoBackupInterval: AutoBackupInterval
    autoBackupKeep: number
  }
  now: () => number
  restoreHistory: (sourcePath: string) => Promise<HistoryRestoreResult>
  /**
   * Run before the JSON files are copied. Settings land on disk a moment
   * after the change is applied, so a backup started by that change would
   * otherwise copy the previous file.
   */
  beforeCopy?: () => void
  /** A fixed sentence. Never a path, a name, a row, or file bytes. */
  log: (message: string) => void
  /** Fired when a window should read status again. */
  onChanged?: () => void
}

export interface AutoBackup {
  check: () => Promise<void>
  status: () => Promise<AutoBackupStatus>
  setDirectory: (absolutePath: string | null) => Promise<AutoBackupFolderResult>
  restore: (id: string) => Promise<AutoBackupRestoreResult>
  start: () => void
  stop: () => void
}

interface BackupState {
  directory: string | null
  lastError: AutoBackupProblem | null
  lastErrorAt: number | null
}

interface ListedCopy {
  name: string
  createdAt: number
  bytes: number
}

type CopyPrefix = 'vrx-backup' | 'vrx-safety'
type CopyOutcome = 'saved' | 'failed' | 'integrity'

interface WrittenCopy {
  outcome: CopyOutcome
  /** The finished directory name. Set only when `outcome` is `saved`. */
  name: string | null
}

function emptyState(): BackupState {
  return { directory: null, lastError: null, lastErrorAt: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function formatStamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  return (
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    'T' +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    pad(date.getUTCMilliseconds(), 3) +
    'Z'
  )
}

function keepCount(value: number): number {
  if (!Number.isInteger(value) || value < AUTO_BACKUP_KEEP_MIN || value > AUTO_BACKUP_KEEP_MAX) {
    return AUTO_BACKUP_KEEP_DEFAULT
  }
  return value
}

function stripTrailingSep(folder: string): string {
  return folder.length > 1 && folder.endsWith(sep) ? folder.slice(0, -1) : folder
}

/** A backup id is only the directory name. Anything else is not a copy. */
export function isBackupId(id: string): boolean {
  return (
    id.length > 0 &&
    id === basename(id) &&
    !id.includes('..') &&
    !id.includes('/') &&
    !id.includes('\\') &&
    BACKUP_DIR.test(id)
  )
}

function parseState(raw: unknown): BackupState {
  if (!isRecord(raw)) return emptyState()
  const directory =
    typeof raw.directory === 'string' && isAbsolute(raw.directory) ? raw.directory : null
  const lastError =
    raw.lastError === 'failed' || raw.lastError === 'folder' || raw.lastError === 'integrity'
      ? raw.lastError
      : null
  const lastErrorAt =
    typeof raw.lastErrorAt === 'number' && Number.isFinite(raw.lastErrorAt) ? raw.lastErrorAt : null
  return { directory, lastError, lastErrorAt }
}

async function readState(userData: string): Promise<BackupState> {
  try {
    return parseState(JSON.parse(await readFile(join(userData, STATE_FILE), 'utf8')) as unknown)
  } catch {
    return emptyState()
  }
}

async function writeState(userData: string, state: BackupState): Promise<void> {
  const temp = join(userData, `${STATE_FILE}.tmp`)
  await writeFile(temp, JSON.stringify(state), 'utf8')
  await rename(temp, join(userData, STATE_FILE))
}

async function readEntries(folder: string): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
}

/** True when `child` is a real path strictly inside `parent`. */
async function contained(parent: string, child: string): Promise<boolean> {
  try {
    const rel = relative(await realpath(parent), await realpath(child))
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

async function usableDirectory(folder: string): Promise<boolean> {
  if (!isAbsolute(folder)) return false
  try {
    const info = await lstat(folder)
    if (info.isSymbolicLink() || !info.isDirectory()) return false
    await access(folder, constants.W_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function ensureDefaultFolder(userData: string): Promise<string | null> {
  const folder = join(userData, DEFAULT_FOLDER_NAME)
  let info: Awaited<ReturnType<typeof lstat>> | undefined
  try {
    info = await lstat(folder)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return null
  }
  if (info === undefined) {
    try {
      await mkdir(folder)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') return null
    }
    try {
      info = await lstat(folder)
    } catch {
      return null
    }
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return null
  try {
    await access(folder, constants.W_OK | constants.X_OK)
  } catch {
    return null
  }
  return folder
}

async function removeContainedDirectory(folder: string, name: string): Promise<boolean> {
  if (name !== basename(name) || name.includes('..')) return false
  const target = join(folder, name)
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isDirectory()) return false
    if (!(await contained(folder, target))) return false
    await rm(target, { recursive: true })
    return true
  } catch {
    return false
  }
}

async function discard(partial: string): Promise<void> {
  await rm(partial, { recursive: true, force: true }).catch(() => undefined)
}

function verifiedHistory(file: string): 'ok' | 'integrity' | 'failed' {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file)
    const rows = db.prepare('PRAGMA integrity_check').all()
    const values = rows.map((row) =>
      typeof row === 'object' && row !== null && 'integrity_check' in row
        ? row.integrity_check
        : undefined
    )
    if (values.length !== 1 || values[0] !== 'ok') return 'integrity'
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // A snapshot from VACUUM INTO is one file and has nothing to checkpoint.
    }
  } catch {
    return 'failed'
  } finally {
    try {
      db?.close()
    } catch {
      // Already closed.
    }
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = `${file}${suffix}`
    try {
      const info = lstatSync(side)
      if (info.isSymbolicLink() || info.isFile()) unlinkSync(side)
      else return 'failed'
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue
      return 'failed'
    }
  }
  return 'ok'
}

async function readManifest(dir: string): Promise<{ createdAt: number } | null> {
  const file = join(dir, 'manifest.json')
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile()) return null
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!isRecord(raw) || raw.kind !== 'vrx-backup' || raw.version !== 1) return null
    if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null
    return { createdAt: raw.createdAt }
  } catch {
    return null
  }
}

async function directoryBytes(dir: string): Promise<number> {
  let total = 0
  for (const name of [HISTORY_FILE, ...JSON_FILES, 'manifest.json']) {
    try {
      const info = await lstat(join(dir, name))
      if (!info.isSymbolicLink() && info.isFile()) total += info.size
    } catch {
      // This copy does not have that file.
    }
  }
  return total
}

async function listBackupCopies(folder: string): Promise<ListedCopy[]> {
  const found: ListedCopy[] = []
  for (const entry of await readEntries(folder)) {
    if (!BACKUP_DIR.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
    const dir = join(folder, entry.name)
    if (!(await contained(folder, dir))) continue
    const manifest = await readManifest(dir)
    if (manifest === null) continue
    found.push({
      name: entry.name,
      createdAt: manifest.createdAt,
      bytes: await directoryBytes(dir)
    })
  }
  return found
}

function passRestore(result: HistoryRestoreResult): AutoBackupRestoreResult {
  if (result.ok) return { ok: true }
  if (
    result.reason === 'off' ||
    result.reason === 'not-a-backup' ||
    result.reason === 'newer' ||
    result.reason === 'failed'
  ) {
    return { ok: false, reason: result.reason }
  }
  return { ok: false, reason: 'failed' }
}

export function createAutoBackup(options: AutoBackupOptions): AutoBackup {
  let busy = false
  let timer: ReturnType<typeof setInterval> | null = null

  const tryBegin = (): boolean => {
    if (busy) return false
    busy = true
    return true
  }
  const finish = (): void => {
    busy = false
  }
  const beginWhenFree = async (): Promise<void> => {
    while (!tryBegin()) await new Promise((resolve) => setImmediate(resolve))
  }
  const notify = (): void => {
    try {
      options.onChanged?.()
    } catch {
      options.log('automatic backup failed')
    }
  }

  const resolveFolder = async (
    userData: string,
    directory: string | null
  ): Promise<string | null> => {
    if (directory === null) return ensureDefaultFolder(userData)
    return (await usableDirectory(directory)) ? directory : null
  }

  /** Skip a symlink or anything that is not a regular file. Absent is a skip. */
  const copyRegularFile = async (source: string, dest: string): Promise<boolean> => {
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(source)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false
      throw error
    }
    if (info.isSymbolicLink() || !info.isFile()) return false
    await copyFile(source, dest)
    return true
  }

  const writeManifest = async (
    dir: string,
    createdAt: number,
    files: readonly string[]
  ): Promise<void> => {
    const temp = join(dir, '.manifest.json.tmp')
    await writeFile(
      temp,
      JSON.stringify({ kind: 'vrx-backup', version: 1, createdAt, files }),
      'utf8'
    )
    await rename(temp, join(dir, 'manifest.json'))
  }

  const writeCopy = async (
    folder: string,
    userData: string,
    prefix: CopyPrefix
  ): Promise<WrittenCopy> => {
    const createdAt = options.now()
    const name = `${prefix}-${formatStamp(createdAt)}`
    const partial = join(folder, `${name}.partial`)
    await discard(partial)
    try {
      await mkdir(partial)
      options.beforeCopy?.()
      const files: string[] = []
      if (options.historyIsFile()) {
        const historyPath = join(partial, HISTORY_FILE)
        let snap: 'saved' | 'failed' | 'stopped' = 'failed'
        try {
          snap = options.snapshotHistory(historyPath)
        } catch {
          snap = 'failed'
        }
        if (snap !== 'saved') {
          await discard(partial)
          return { outcome: 'failed', name: null }
        }
        const checked = verifiedHistory(historyPath)
        if (checked !== 'ok') {
          await discard(partial)
          return { outcome: checked, name: null }
        }
        files.push(HISTORY_FILE)
      }
      for (const fileName of JSON_FILES) {
        if (await copyRegularFile(join(userData, fileName), join(partial, fileName))) {
          files.push(fileName)
        }
      }
      await writeManifest(partial, createdAt, files)
      await rename(partial, join(folder, name))
      return { outcome: 'saved', name }
    } catch {
      await discard(partial)
      return { outcome: 'failed', name: null }
    }
  }

  const removePartials = async (folder: string): Promise<void> => {
    for (const entry of await readEntries(folder)) {
      if (!BACKUP_PARTIAL.test(entry.name) && !SAFETY_PARTIAL.test(entry.name)) continue
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      await removeContainedDirectory(folder, entry.name)
    }
  }

  const pruneSafety = async (folder: string, keepName: string | null): Promise<boolean> => {
    const names: string[] = []
    for (const entry of await readEntries(folder)) {
      if (!SAFETY_DIR.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
      if (!(await contained(folder, join(folder, entry.name)))) continue
      names.push(entry.name)
    }
    // The copy just written is the one that has to survive. Its name is a
    // clock stamp, so a clock step backward would sort it behind an older
    // copy and the prune would delete the rows it was made to keep.
    const keep =
      keepName ??
      names.reduce<string | null>(
        (best, name) => (best === null || name > best ? name : best),
        null
      )
    let removed = false
    for (const name of names) {
      if (name === keep) continue
      if (await removeContainedDirectory(folder, name)) removed = true
    }
    return removed
  }

  const rotate = async (folder: string, keep: number): Promise<boolean> => {
    const copies = await listBackupCopies(folder)
    copies.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1))
    let removed = false
    for (const extra of copies.slice(keep)) {
      if (await removeContainedDirectory(folder, extra.name)) removed = true
    }
    if (await pruneSafety(folder, null)) removed = true
    return removed
  }

  const storeError = async (
    userData: string,
    state: BackupState,
    problem: AutoBackupProblem
  ): Promise<boolean> => {
    if (state.lastError === problem) return false
    await writeState(userData, {
      directory: state.directory,
      lastError: problem,
      lastErrorAt: options.now()
    })
    return true
  }

  const clearError = async (userData: string, state: BackupState): Promise<boolean> => {
    if (state.lastError === null && state.lastErrorAt === null) return false
    await writeState(userData, { directory: state.directory, lastError: null, lastErrorAt: null })
    return true
  }

  const runCheck = async (): Promise<boolean> => {
    const settings = options.settings()
    if (!settings.autoBackup) return false
    const userData = options.userDataDir()
    const state = await readState(userData)
    const folder = await resolveFolder(userData, state.directory)
    if (folder === null) {
      options.log('automatic backup folder unusable')
      return storeError(userData, state, 'folder')
    }
    await removePartials(folder)
    const copies = await listBackupCopies(folder)
    const newest = copies.reduce<number | null>(
      (max, copy) => (max === null || copy.createdAt > max ? copy.createdAt : max),
      null
    )
    const interval = INTERVAL_MS[settings.autoBackupInterval] ?? INTERVAL_MS.daily
    const due = newest === null || options.now() - newest >= interval
    let notify = false
    if (due) {
      const written = await writeCopy(folder, userData, 'vrx-backup')
      if (written.outcome === 'saved') {
        await clearError(userData, state)
        options.log('automatic backup saved')
        notify = true
      } else {
        options.log(
          written.outcome === 'integrity' ? 'automatic backup discarded' : 'automatic backup failed'
        )
        if (
          await storeError(
            userData,
            state,
            written.outcome === 'integrity' ? 'integrity' : 'failed'
          )
        ) {
          notify = true
        }
      }
    } else if (state.lastError === 'folder') {
      notify = await clearError(userData, state)
    }
    if (await rotate(folder, keepCount(settings.autoBackupKeep))) notify = true
    return notify
  }

  const check = async (): Promise<void> => {
    if (!options.settings().autoBackup) return
    if (!tryBegin()) return
    let changed: boolean
    try {
      changed = await runCheck()
    } catch {
      options.log('automatic backup failed')
      changed = true
    } finally {
      finish()
    }
    if (changed) notify()
  }

  const status = async (): Promise<AutoBackupStatus> => {
    const userData = options.userDataDir()
    const state = await readState(userData)
    const directory = state.directory
    const folder = directory ?? join(userData, DEFAULT_FOLDER_NAME)
    const copies = await listBackupCopies(folder)
    copies.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1))
    return {
      usingDefaultFolder: directory === null,
      folderName: directory === null ? DEFAULT_FOLDER_NAME : basename(directory),
      lastBackupAt: copies[0]?.createdAt ?? null,
      lastError: state.lastError,
      copies: copies.map((copy) => ({
        id: copy.name,
        createdAt: copy.createdAt,
        bytes: copy.bytes
      }))
    }
  }

  const setDirectory = async (absolutePath: string | null): Promise<AutoBackupFolderResult> => {
    await beginWhenFree()
    let result: AutoBackupFolderResult = { ok: false, reason: 'failed' }
    let changed = false
    try {
      const userData = options.userDataDir()
      const state = await readState(userData)
      if (absolutePath === null) {
        result = { ok: true, usingDefaultFolder: true, folderName: DEFAULT_FOLDER_NAME }
        if (state.directory !== null) {
          await writeState(userData, { ...state, directory: null })
          changed = true
        }
      } else {
        const folder = stripTrailingSep(absolutePath)
        if (state.directory === folder) {
          result = { ok: true, usingDefaultFolder: false, folderName: basename(folder) }
        } else if (await usableDirectory(folder)) {
          await writeState(userData, { ...state, directory: folder })
          result = { ok: true, usingDefaultFolder: false, folderName: basename(folder) }
          changed = true
        }
      }
    } catch {
      options.log('automatic backup folder unusable')
      result = { ok: false, reason: 'failed' }
    } finally {
      finish()
    }
    if (changed) notify()
    return result
  }

  const regularFile = async (file: string): Promise<boolean> => {
    try {
      const info = await lstat(file)
      return !info.isSymbolicLink() && info.isFile() && info.size > 0
    } catch {
      return false
    }
  }

  const runRestore = async (id: string): Promise<AutoBackupRestoreResult> => {
    const userData = options.userDataDir()
    const state = await readState(userData)
    const folder = state.directory ?? join(userData, DEFAULT_FOLDER_NAME)
    const target = join(folder, id)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(target)
    } catch {
      return { ok: false, reason: 'unknown' }
    }
    if (info.isSymbolicLink() || !info.isDirectory() || !(await contained(folder, target))) {
      return { ok: false, reason: 'unknown' }
    }
    if ((await readManifest(target)) === null || !(await regularFile(join(target, HISTORY_FILE)))) {
      return { ok: false, reason: 'not-a-backup' }
    }
    const safety = await writeCopy(folder, userData, 'vrx-safety')
    if (safety.outcome !== 'saved' || safety.name === null) {
      options.log('automatic restore failed')
      return { ok: false, reason: 'failed' }
    }
    await pruneSafety(folder, safety.name)
    return passRestore(await options.restoreHistory(join(target, HISTORY_FILE)))
  }

  const restore = async (id: string): Promise<AutoBackupRestoreResult> => {
    if (!isBackupId(id)) return { ok: false, reason: 'unknown' }
    if (!options.historyIsFile()) return { ok: false, reason: 'off' }
    if (!tryBegin()) return { ok: false, reason: 'failed' }
    let result: AutoBackupRestoreResult
    try {
      result = await runRestore(id)
    } catch {
      options.log('automatic restore failed')
      result = { ok: false, reason: 'failed' }
    } finally {
      finish()
    }
    notify()
    return result
  }

  const start = (): void => {
    void check()
    if (timer !== null) return
    timer = setInterval(() => {
      void check()
    }, CHECK_EVERY_MS)
    timer.unref()
  }

  const stop = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  return { check, status, setDirectory, restore, start, stop }
}
