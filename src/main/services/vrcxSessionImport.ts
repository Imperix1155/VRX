import { app } from 'electron'
import { constants, type BigIntStats } from 'node:fs'
import { chmod, lstat, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TextDecoder } from 'node:util'
import { CREDENTIAL_KEYS, saveCredential } from './credentials'
import { isValidVrcSessionCookie } from './adapters/credentialValidation'
import { copyOpenFile } from './vrcxSnapshotCopy'

const MAX_COOKIE_STORAGE_BYTES = 256 * 1024
const MAX_COOKIE_STORAGE_ROWS = 64
const MAX_COOKIE_COUNT = 64
const MAX_VRCX_DATABASE_BYTES = 512 * 1024 * 1024
const LOCK_RETRY_DELAY_MS = 25
const SNAPSHOT_ROOT_PREFIX = 'vrx-vrcx-session-import-'
const SNAPSHOT_ROOT_PATTERN = /^vrx-vrcx-session-import-[A-Za-z0-9]{6}$/
const SNAPSHOT_MARKER_NAME = '.vrx-vrcx-session-import-root'
const SNAPSHOT_MARKER_PATTERN = /^VRX VRCX snapshot v1\n([1-9][0-9]{0,9})\n$/
const MAX_SNAPSHOT_MARKER_BYTES = 64
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const COOKIE_OCTETS = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

class TransientSnapshotError extends Error {}

class RejectedSnapshotError extends Error {}

interface VrcxCookie {
  Name: string
  Value: string
  Domain: string
}

interface CookieValueRow {
  value?: unknown
}

interface CookieMetadataRow {
  storageRowId?: unknown
  keyType?: unknown
  keyBytes?: unknown
  valueType?: unknown
  valueBytes?: unknown
}

interface CookieKeyRow {
  key?: unknown
}

interface JournalModeRow {
  journal_mode?: unknown
}

interface SchemaObjectRow {
  type?: unknown
  rootpage?: unknown
}

interface TableColumnRow {
  name?: unknown
  hidden?: unknown
}

interface SourceFileVersion {
  dev: bigint
  ino: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

function sourceVersion(value: BigIntStats): SourceFileVersion {
  return {
    dev: value.dev,
    ino: value.ino,
    nlink: value.nlink,
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs
  }
}

function hasStoredCookieColumns(database: DatabaseSync): boolean {
  const schemaRows = database
    .prepare(
      `SELECT type, rootpage
       FROM sqlite_schema
       WHERE name = ?
       LIMIT 2`
    )
    .all('cookies') as SchemaObjectRow[]
  if (
    schemaRows.length !== 1 ||
    schemaRows[0]?.type !== 'table' ||
    typeof schemaRows[0].rootpage !== 'number' ||
    !Number.isInteger(schemaRows[0].rootpage) ||
    schemaRows[0].rootpage < 1
  ) {
    return false
  }

  const columns = database.prepare("PRAGMA table_xinfo('cookies')").all() as TableColumnRow[]
  const shadowsRowId = columns.some(
    (column) =>
      typeof column.name === 'string' &&
      ['rowid', '_rowid_', 'oid'].includes(column.name.toLowerCase())
  )
  return (
    !shadowsRowId &&
    ['key', 'value'].every(
      (name) => columns.filter((column) => column.name === name && column.hidden === 0).length === 1
    )
  )
}

function readCookieStorage(databasePath: string): unknown {
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 25 })

  try {
    const journalMode = database.prepare('PRAGMA journal_mode').get() as JournalModeRow
    if (journalMode.journal_mode !== 'delete') return null
    if (!hasStoredCookieColumns(database)) return null

    const metadataRows = database
      .prepare(
        `SELECT _rowid_ AS \`storageRowId\`,
                typeof(\`key\`) AS \`keyType\`,
                octet_length(\`key\`) AS \`keyBytes\`,
                typeof(\`value\`) AS \`valueType\`,
                octet_length(\`value\`) AS \`valueBytes\`
         FROM \`cookies\`
         LIMIT ?`
      )
      .all(MAX_COOKIE_STORAGE_ROWS + 1) as CookieMetadataRow[]
    if (metadataRows.length > MAX_COOKIE_STORAGE_ROWS) return null

    const readKey = database.prepare('SELECT `key` FROM `cookies` WHERE _rowid_ = ? LIMIT 1')
    const defaultRows = metadataRows.filter((metadata) => {
      if (
        typeof metadata.storageRowId !== 'number' ||
        metadata.keyType !== 'text' ||
        metadata.keyBytes !== 'default'.length
      ) {
        return false
      }
      const row = readKey.get(metadata.storageRowId) as CookieKeyRow | undefined
      return row?.key === 'default'
    })
    const metadata = defaultRows[0]
    const storageRowId = metadata?.storageRowId
    if (
      defaultRows.length !== 1 ||
      typeof storageRowId !== 'number' ||
      metadata?.valueType !== 'text' ||
      typeof metadata.valueBytes !== 'number' ||
      metadata.valueBytes < 1 ||
      metadata.valueBytes > MAX_COOKIE_STORAGE_BYTES
    ) {
      return null
    }

    const row = database
      .prepare('SELECT `value` FROM `cookies` WHERE _rowid_ = ? LIMIT 1')
      .get(storageRowId) as CookieValueRow | undefined
    return row?.value
  } finally {
    database.close()
  }
}

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return (error as { code?: unknown }).code === 'ENOENT'
}

function isRetryableSnapshotError(error: unknown): boolean {
  if (error instanceof TransientSnapshotError) return true
  if (error instanceof RejectedSnapshotError) return false
  if (typeof error !== 'object' || error === null) return false

  if ('errcode' in error) {
    const errcode = (error as { errcode?: unknown }).errcode
    if (errcode === 5 || errcode === 6) return true
  }
  if ('code' in error) {
    const code = (error as { code?: unknown }).code
    return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM'
  }
  return false
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function removeSnapshotPath(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
  } catch {
    throw new RejectedSnapshotError()
  }
}

async function isOwnedDirectory(path: string): Promise<boolean> {
  try {
    const value = await lstat(path)
    if (!value.isDirectory() || value.isSymbolicLink()) return false
    return typeof process.getuid !== 'function' || value.uid === process.getuid()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function readSnapshotMarkerPid(path: string): Promise<number | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const markerPath = join(path, SNAPSHOT_MARKER_NAME)
    const pathMetadata = await lstat(markerPath)
    if (
      !pathMetadata.isFile() ||
      pathMetadata.isSymbolicLink() ||
      pathMetadata.size < 1 ||
      pathMetadata.size > MAX_SNAPSHOT_MARKER_BYTES
    ) {
      return null
    }
    handle = await open(
      markerPath,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    )
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_SNAPSHOT_MARKER_BYTES) {
      return null
    }
    const marker = Buffer.alloc(metadata.size)
    const { bytesRead } = await handle.read(marker, 0, marker.length, 0)
    if (bytesRead !== marker.length) return null
    const match = SNAPSHOT_MARKER_PATTERN.exec(marker.toString('ascii'))
    if (match?.[1] === undefined) return null
    const pid = Number(match[1])
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function createSnapshotMarker(path: string): Promise<void> {
  const handle = await open(join(path, SNAPSHOT_MARKER_NAME), 'wx', 0o600)
  try {
    await handle.writeFile(`VRX VRCX snapshot v1\n${process.pid}\n`)
  } finally {
    await handle.close()
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error)) return true
    return (error as { code?: unknown }).code !== 'ESRCH'
  }
}

async function scavengeSnapshotRoots(tempPath: string): Promise<void> {
  const entries = await readdir(tempPath)
  for (const entry of entries) {
    if (!SNAPSHOT_ROOT_PATTERN.test(entry)) continue
    const path = join(tempPath, entry)
    if (!(await isOwnedDirectory(path))) continue
    const markerPid = await readSnapshotMarkerPid(path)
    if (markerPid !== null && !isProcessRunning(markerPid)) {
      await removeSnapshotPath(path)
    }
  }
}

async function sourceFileVersion(
  path: string,
  optional = false
): Promise<SourceFileVersion | null> {
  try {
    const value = await lstat(path, { bigint: true })
    if (!value.isFile() || value.nlink !== 1n) throw new RejectedSnapshotError()
    return sourceVersion(value)
  } catch (error) {
    if (optional && isMissing(error)) return null
    throw error
  }
}

async function sourceDirectoryVersion(path: string): Promise<SourceFileVersion> {
  const value = await lstat(path, { bigint: true })
  if (!value.isDirectory() || value.isSymbolicLink()) throw new RejectedSnapshotError()
  return sourceVersion(value)
}

async function sourceHandleVersion(
  handle: Awaited<ReturnType<typeof open>>
): Promise<SourceFileVersion> {
  const value = await handle.stat({ bigint: true })
  if (!value.isFile() || value.nlink !== 1n) throw new RejectedSnapshotError()
  return sourceVersion(value)
}

async function openSourceFile(
  path: string
): Promise<{ handle: Awaited<ReturnType<typeof open>>; version: SourceFileVersion }> {
  const beforePathVersion = await sourceFileVersion(path)
  if (beforePathVersion === null) throw new RejectedSnapshotError()
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    const version = await sourceHandleVersion(handle)
    const afterPathVersion = await sourceFileVersion(path)
    if (
      !sameSourceVersion(beforePathVersion, version) ||
      !sameSourceVersion(version, afterPathVersion)
    ) {
      throw new RejectedSnapshotError()
    }
    return { handle, version }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

function sameSourceVersion(
  left: SourceFileVersion | null,
  right: SourceFileVersion | null
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function isAtOrBelow(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function requireSameSourceVersion(
  expected: SourceFileVersion,
  actual: SourceFileVersion | null
): void {
  if (!sameSourceVersion(expected, actual)) throw new RejectedSnapshotError()
}

async function requireWalDatabaseHeader(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  const header = Buffer.alloc(20)
  const { bytesRead } = await handle.read(header, 0, header.length, 0)
  if (
    bytesRead !== header.length ||
    header.toString('binary', 0, 16) !== 'SQLite format 3\0' ||
    header[18] !== 2 ||
    header[19] !== 2
  ) {
    throw new RejectedSnapshotError()
  }
}

function assertSourceBounds(main: SourceFileVersion): void {
  if (main.size > BigInt(MAX_VRCX_DATABASE_BYTES)) throw new RejectedSnapshotError()
}

async function normalizeSnapshotForRead(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  // The source was already proven to be a checkpointed WAL database. Switching
  // only the private copy's SQLite header to rollback mode makes the read-only
  // parser ignore any WAL sidecars planted beside the snapshot.
  const rollbackMode = Buffer.from([1, 1])
  const { bytesWritten } = await handle.write(rollbackMode, 0, rollbackMode.length, 18)
  if (bytesWritten !== rollbackMode.length) throw new RejectedSnapshotError()
  await handle.sync()
}

async function requireOnlySnapshotDatabase(path: string): Promise<void> {
  const entries = await readdir(path)
  if (entries.length !== 1 || entries[0] !== 'VRCX.sqlite3') {
    throw new RejectedSnapshotError()
  }
}

async function readCookieStorageFromSnapshot(
  sourcePath: string,
  snapshotRoot: string
): Promise<unknown> {
  const snapshotDirectory = await mkdtemp(join(snapshotRoot, 'snapshot-'))
  const snapshotPath = join(snapshotDirectory, 'VRCX.sqlite3')
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined
  let snapshotHandle: Awaited<ReturnType<typeof open>> | undefined

  try {
    const sourceDirectory = dirname(sourcePath)
    const sourceDirectoryParent = dirname(sourceDirectory)
    const beforeDirectoryParent = await sourceDirectoryVersion(sourceDirectoryParent)
    const beforeDirectory = await sourceDirectoryVersion(sourceDirectory)
    const source = await openSourceFile(sourcePath)
    sourceHandle = source.handle
    const beforeMain = source.version
    const beforeWal = await sourceFileVersion(`${sourcePath}-wal`, true)
    const beforeShm = await sourceFileVersion(`${sourcePath}-shm`, true)
    const beforeJournal = await sourceFileVersion(`${sourcePath}-journal`, true)
    if (beforeWal !== null && beforeWal.size > 0n) throw new TransientSnapshotError()
    if (beforeShm !== null && beforeShm.size > 0n) throw new TransientSnapshotError()
    if (beforeJournal !== null && beforeJournal.size > 0n) {
      throw new TransientSnapshotError()
    }
    assertSourceBounds(beforeMain)
    await requireWalDatabaseHeader(sourceHandle)

    const copiedSnapshot = await copyOpenFile(sourceHandle, snapshotPath, Number(beforeMain.size))
    snapshotHandle = copiedSnapshot.handle
    requireSameSourceVersion(copiedSnapshot.version, await sourceFileVersion(snapshotPath))
    requireSameSourceVersion(copiedSnapshot.version, await sourceHandleVersion(snapshotHandle))

    const afterHandle = await sourceHandleVersion(sourceHandle)
    const afterMain = await sourceFileVersion(sourcePath)
    const afterWal = await sourceFileVersion(`${sourcePath}-wal`, true)
    const afterShm = await sourceFileVersion(`${sourcePath}-shm`, true)
    const afterJournal = await sourceFileVersion(`${sourcePath}-journal`, true)
    const afterDirectory = await sourceDirectoryVersion(sourceDirectory)
    const afterDirectoryParent = await sourceDirectoryVersion(sourceDirectoryParent)
    if (
      afterMain === null ||
      (afterShm !== null && afterShm.size > 0n) ||
      (afterJournal !== null && afterJournal.size > 0n) ||
      !sameSourceVersion(beforeMain, afterHandle) ||
      !sameSourceVersion(beforeMain, afterMain) ||
      !sameSourceVersion(beforeWal, afterWal) ||
      !sameSourceVersion(beforeShm, afterShm) ||
      !sameSourceVersion(beforeJournal, afterJournal) ||
      !sameSourceVersion(beforeDirectory, afterDirectory) ||
      !sameSourceVersion(beforeDirectoryParent, afterDirectoryParent)
    ) {
      throw new TransientSnapshotError()
    }

    const beforeNormalizationDirectory = await sourceDirectoryVersion(snapshotDirectory)
    await requireOnlySnapshotDatabase(snapshotDirectory)
    await normalizeSnapshotForRead(snapshotHandle)
    await requireOnlySnapshotDatabase(snapshotDirectory)
    requireSameSourceVersion(
      beforeNormalizationDirectory,
      await sourceDirectoryVersion(snapshotDirectory)
    )
    const snapshotVersion = await sourceHandleVersion(snapshotHandle)
    const beforeSnapshot = await sourceFileVersion(snapshotPath)
    requireSameSourceVersion(snapshotVersion, beforeSnapshot)
    requireSameSourceVersion(snapshotVersion, await sourceHandleVersion(snapshotHandle))
    await requireOnlySnapshotDatabase(snapshotDirectory)
    const beforeSnapshotRoot = await sourceDirectoryVersion(snapshotRoot)
    const beforeSnapshotDirectory = await sourceDirectoryVersion(snapshotDirectory)
    const result = readCookieStorage(snapshotPath)
    const afterSnapshot = await sourceFileVersion(snapshotPath)
    const afterSnapshotHandle = await sourceHandleVersion(snapshotHandle)
    await requireOnlySnapshotDatabase(snapshotDirectory)
    const afterSnapshotDirectory = await sourceDirectoryVersion(snapshotDirectory)
    const afterSnapshotRoot = await sourceDirectoryVersion(snapshotRoot)
    requireSameSourceVersion(snapshotVersion, afterSnapshot)
    requireSameSourceVersion(snapshotVersion, afterSnapshotHandle)
    requireSameSourceVersion(beforeSnapshotDirectory, afterSnapshotDirectory)
    requireSameSourceVersion(beforeSnapshotRoot, afterSnapshotRoot)
    return result
  } finally {
    await snapshotHandle?.close().catch(() => undefined)
    await sourceHandle?.close().catch(() => undefined)
    await removeSnapshotPath(snapshotDirectory)
  }
}

async function readCookieStorageWithRetry(
  databasePath: string,
  snapshotRoot: string
): Promise<unknown> {
  try {
    return await readCookieStorageFromSnapshot(databasePath, snapshotRoot)
  } catch (error) {
    if (!isRetryableSnapshotError(error)) throw error
    await delay(LOCK_RETRY_DELAY_MS)
    return readCookieStorageFromSnapshot(databasePath, snapshotRoot)
  }
}

async function readCookieStorageInTemporaryRoot(databasePath: string): Promise<unknown> {
  const sourceDirectory = await realpath(dirname(databasePath))
  const tempPath = await realpath(app.getPath('temp'))
  if (isAtOrBelow(sourceDirectory, tempPath) || isAtOrBelow(tempPath, sourceDirectory)) {
    throw new RejectedSnapshotError()
  }
  await scavengeSnapshotRoots(tempPath)
  const snapshotRoot = await mkdtemp(join(tempPath, SNAPSHOT_ROOT_PREFIX))

  try {
    const resolvedSnapshotRoot = await realpath(snapshotRoot)
    if (isAtOrBelow(sourceDirectory, resolvedSnapshotRoot)) throw new RejectedSnapshotError()
    await chmod(snapshotRoot, 0o700)
    await createSnapshotMarker(snapshotRoot)
    return await readCookieStorageWithRetry(databasePath, snapshotRoot)
  } finally {
    await removeSnapshotPath(snapshotRoot)
  }
}

function isVrcxCookie(value: unknown): value is VrcxCookie {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const cookie = value as Record<string, unknown>
  return (
    typeof cookie.Name === 'string' &&
    typeof cookie.Value === 'string' &&
    typeof cookie.Domain === 'string'
  )
}

function decodeCookies(value: unknown): VrcxCookie[] | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_COOKIE_STORAGE_BYTES ||
    !BASE64.test(value)
  ) {
    return null
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) return null

  try {
    const parsed: unknown = JSON.parse(UTF8_DECODER.decode(decoded))
    if (!Array.isArray(parsed) || parsed.length > MAX_COOKIE_COUNT) return null
    if (!parsed.every(isVrcxCookie)) return null
    return parsed
  } catch {
    return null
  }
}

function isVrcDomain(value: string): boolean {
  const domain = value.toLowerCase().replace(/^\./, '')
  return domain === 'vrchat.cloud' || domain === 'api.vrchat.cloud'
}

function cookieHeader(cookies: VrcxCookie[]): string | null {
  const vrchatCookies = cookies.filter((cookie) => isVrcDomain(cookie.Domain))
  const auth = vrchatCookies.filter((cookie) => cookie.Name === 'auth')
  const twoFactorAuth = vrchatCookies.filter((cookie) => cookie.Name === 'twoFactorAuth')
  const authCookie = auth[0]
  const twoFactorAuthCookie = twoFactorAuth[0]
  if (auth.length !== 1 || twoFactorAuth.length > 1) return null
  if (authCookie === undefined) return null
  if (!COOKIE_OCTETS.test(authCookie.Value)) return null
  if (twoFactorAuthCookie !== undefined && !COOKIE_OCTETS.test(twoFactorAuthCookie.Value)) {
    return null
  }

  const parts = [`auth=${authCookie.Value}`]
  if (twoFactorAuthCookie !== undefined) {
    parts.push(`twoFactorAuth=${twoFactorAuthCookie.Value}`)
  }
  const header = parts.join('; ')
  return isValidVrcSessionCookie(header) ? header : null
}

async function importVrcxSessionOnce(): Promise<'imported' | null> {
  const databasePath = join(app.getPath('appData'), 'VRCX', 'VRCX.sqlite3')
  try {
    const cookies = decodeCookies(await readCookieStorageInTemporaryRoot(databasePath))
    if (cookies === null) return null
    const header = cookieHeader(cookies)
    if (header === null) return null

    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, header)
    return 'imported'
  } catch {
    return null
  }
}

let importInFlight: Promise<'imported' | null> | null = null

export function importVrcxSession(): Promise<'imported' | null> {
  if (importInFlight !== null) return importInFlight
  const operation = importVrcxSessionOnce().finally(() => {
    if (importInFlight === operation) importInFlight = null
  })
  importInFlight = operation
  return operation
}
