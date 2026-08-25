import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  truncate,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn<(name: string) => string>(),
  saveCredential: vi.fn<(key: string, value: string) => void>(),
  copyOpenFile: vi.fn<typeof import('./vrcxSnapshotCopy').copyOpenFile>(),
  realCopyOpenFile: undefined as typeof import('./vrcxSnapshotCopy').copyOpenFile | undefined
}))

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('./vrcxSnapshotCopy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vrcxSnapshotCopy')>()
  mocks.realCopyOpenFile = actual.copyOpenFile
  mocks.copyOpenFile.mockImplementation(actual.copyOpenFile)
  return { copyOpenFile: mocks.copyOpenFile }
})
vi.mock('./credentials', () => ({
  CREDENTIAL_KEYS: { VRCHAT_PRIMARY: 'vrchat:primary' },
  saveCredential: mocks.saveCredential
}))

import { importVrcxSession } from './vrcxSessionImport'

const COOKIE_PAYLOAD = Buffer.from(
  JSON.stringify([
    {
      Name: 'auth',
      Value: 'authcookie_primary',
      Domain: '.vrchat.cloud',
      Path: '/',
      Secure: true,
      HttpOnly: true
    },
    {
      Name: 'twoFactorAuth',
      Value: 'twofactor_secondary',
      Domain: '.vrchat.cloud',
      Path: '/',
      Secure: true,
      HttpOnly: true
    }
  ])
).toString('base64')
const execFileAsync = promisify(execFile)
type CopyOpenFile = typeof import('./vrcxSnapshotCopy').copyOpenFile

function encodeCookies(cookies: unknown): string {
  return Buffer.from(JSON.stringify(cookies)).toString('base64')
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('VRCX session import', () => {
  let rootPath: string
  let appDataPath: string
  let tempPath: string

  function databasePath(): string {
    return join(appDataPath, 'VRCX', 'VRCX.sqlite3')
  }

  async function createDatabase(value: string | Buffer = COOKIE_PAYLOAD): Promise<string> {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    database.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE cookies (`key` TEXT PRIMARY KEY, `value` TEXT)'
    )
    database.prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?)').run('default', value)
    database.close()
    return path
  }

  async function expectRejectedDatabaseAlias(
    plantAlias: (path: string, targetPath: string) => Promise<void>
  ): Promise<void> {
    const path = await createDatabase()
    const targetPath = join(rootPath, 'target.sqlite3')
    await plantAlias(path, targetPath)
    mocks.copyOpenFile.mockClear()

    await expect(importVrcxSession()).resolves.toBeNull()

    expect(mocks.copyOpenFile).not.toHaveBeenCalled()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
    expect(await readdir(tempPath)).toEqual([])
  }

  async function expectRejectedBeforeCopy(): Promise<void> {
    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.copyOpenFile).not.toHaveBeenCalled()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  }

  async function expectRetryThenNull(): Promise<void> {
    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.copyOpenFile).toHaveBeenCalledTimes(2)
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  }

  async function expectSingleRejectedCopy(): Promise<void> {
    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.copyOpenFile).toHaveBeenCalledTimes(1)
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  }

  async function copySnapshotThen(
    source: Parameters<CopyOpenFile>[0],
    destination: Parameters<CopyOpenFile>[1],
    sourceBytes: Parameters<CopyOpenFile>[2],
    afterCopy: () => Promise<void>
  ): Promise<Awaited<ReturnType<CopyOpenFile>>> {
    if (mocks.realCopyOpenFile === undefined) {
      throw new Error('snapshot copy mock was not initialized')
    }
    const copiedSnapshot = await mocks.realCopyOpenFile(source, destination, sourceBytes)
    await afterCopy()
    return copiedSnapshot
  }

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'vrx-vrcx-import-'))
    appDataPath = join(rootPath, 'app-data')
    tempPath = join(rootPath, 'temp')
    await mkdir(appDataPath)
    await mkdir(tempPath)
    mocks.getPath.mockClear()
    mocks.getPath.mockImplementation((name) => {
      if (name === 'appData') return appDataPath
      if (name === 'temp') return tempPath
      throw new Error(`Unexpected Electron path: ${name}`)
    })
    mocks.saveCredential.mockClear()
    mocks.copyOpenFile.mockClear()
    if (mocks.realCopyOpenFile === undefined) {
      throw new Error('snapshot copy mock was not initialized')
    }
    mocks.copyOpenFile.mockImplementation(mocks.realCopyOpenFile)
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('imports the active VRChat cookies without modifying the VRCX database', async () => {
    const path = await createDatabase()
    const before = digest(await readFile(path))

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(mocks.getPath).toHaveBeenCalledWith('appData')
    expect(mocks.getPath).toHaveBeenCalledWith('temp')
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      'vrchat:primary',
      'auth=authcookie_primary; twoFactorAuth=twofactor_secondary'
    )
    expect(digest(await readFile(path))).toBe(before)
    expect(await readdir(tempPath)).toEqual([])
  })

  it('fails gracefully on an active WAL without creating or changing VRCX sidecars', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const originPath = join(rootPath, 'wal-origin.sqlite3')
    const writer = new DatabaseSync(originPath)
    writer.exec(
      'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE cookies (`key` TEXT PRIMARY KEY, `value` TEXT)'
    )
    writer
      .prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?)')
      .run('default', COOKIE_PAYLOAD)
    await copyFile(originPath, path)
    await copyFile(`${originPath}-wal`, `${path}-wal`)
    const beforeEntries = (await readdir(dirname(path))).sort()
    const beforeMain = digest(await readFile(path))
    const beforeWal = digest(await readFile(`${path}-wal`))
    mocks.copyOpenFile.mockClear()

    try {
      await expect(importVrcxSession()).resolves.toBeNull()

      expect((await readdir(dirname(path))).sort()).toEqual(beforeEntries)
      expect(digest(await readFile(path))).toBe(beforeMain)
      expect(digest(await readFile(`${path}-wal`))).toBe(beforeWal)
      expect(await readdir(tempPath)).toEqual([])
      expect(mocks.copyOpenFile).not.toHaveBeenCalled()
      expect(mocks.saveCredential).not.toHaveBeenCalled()
    } finally {
      writer.close()
    }
  })

  it('returns null when VRCX is not installed', async () => {
    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('returns null for a malformed SQLite database', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'not a SQLite database')

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
    expect(mocks.copyOpenFile).not.toHaveBeenCalled()
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a symlinked database before checking or copying its target',
    async () => {
      await expectRejectedDatabaseAlias(async (path, targetPath) => {
        await copyFile(path, targetPath)
        await rm(path)
        await symlink(targetPath, path)
      })
    }
  )

  it('rejects a hard-linked database alias before checking or copying it', async () => {
    await expectRejectedDatabaseAlias(async (path, targetPath) => {
      await rename(path, targetPath)
      await link(targetPath, path)
    })
  })

  it('rejects a temp path that resolves inside the VRCX directory', async () => {
    const path = await createDatabase()
    const beforeMain = digest(await readFile(path))
    const beforeEntries = await readdir(dirname(path))
    await rm(tempPath, { recursive: true })
    await symlink(dirname(path), tempPath, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(importVrcxSession()).resolves.toBeNull()

    expect(digest(await readFile(path))).toBe(beforeMain)
    expect(await readdir(dirname(path))).toEqual(beforeEntries)
    expect(mocks.copyOpenFile).not.toHaveBeenCalled()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('does not scavenge a marked temp root containing the VRCX source tree', async () => {
    const markedRoot = join(tempPath, 'vrx-vrcx-session-import-Ab12Cd')
    appDataPath = join(markedRoot, 'app-data')
    await mkdir(appDataPath, { recursive: true })
    const path = await createDatabase()
    await writeFile(
      join(markedRoot, '.vrx-vrcx-session-import-root'),
      'VRX VRCX snapshot v1\n2147483647\n'
    )
    const beforeMain = digest(await readFile(path))

    await expect(importVrcxSession()).resolves.toBeNull()

    expect(digest(await readFile(path))).toBe(beforeMain)
    expect(await readdir(markedRoot)).toContain('app-data')
    expect(mocks.copyOpenFile).not.toHaveBeenCalled()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a symlinked SQLite sidecar before copying the database',
    async () => {
      const path = await createDatabase()
      const targetPath = join(rootPath, 'foreign-shm')
      await writeFile(targetPath, Buffer.alloc(32_768))
      await symlink(targetPath, `${path}-shm`)

      await expectRejectedBeforeCopy()
    }
  )

  it('returns null when the cookies table is missing', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    database.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE configs (`key` TEXT PRIMARY KEY, `value` TEXT)'
    )
    database.close()

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it.each([
    [
      'view',
      `CREATE VIEW cookies AS SELECT 'default' AS \`key\`, '${COOKIE_PAYLOAD}' AS \`value\``
    ],
    [
      'generated value column',
      `CREATE TABLE cookies (\`key\` TEXT, source TEXT, \`value\` TEXT GENERATED ALWAYS AS (source) VIRTUAL);
       INSERT INTO cookies (\`key\`, source) VALUES ('default', '${COOKIE_PAYLOAD}')`
    ],
    [
      'table that shadows its row locator',
      `CREATE TABLE cookies (rowid TEXT, \`key\` TEXT, \`value\` TEXT);
       INSERT INTO cookies (rowid, \`key\`, \`value\`) VALUES ('shadow', 'default', '${COOKIE_PAYLOAD}')`
    ]
  ])('rejects a cookies %s before evaluating its values', async (_name, schema) => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    database.exec(`PRAGMA journal_mode=WAL; ${schema}`)
    database.close()

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects invalid UTF-8 anywhere in the cookie collection', async () => {
    const malformed = Buffer.concat([
      Buffer.from(
        '[{"Name":"auth","Value":"authcookie_primary","Domain":".vrchat.cloud"},{"Name":"ignored","Value":"'
      ),
      Buffer.from([0x80]),
      Buffer.from('","Domain":"example.com"}]')
    ]).toString('base64')
    await createDatabase(malformed)

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid base64', '%%%'],
    ['invalid JSON', Buffer.from('{').toString('base64')],
    ['non-array JSON', encodeCookies({ Name: 'auth', Value: 'authcookie_primary' })],
    ['non-text SQLite value', Buffer.from([0xff, 0xfe, 0xfd])]
  ])('returns null for %s cookie storage', async (_name, value) => {
    await createDatabase(value)

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it.each([
    'authcookie\npoison',
    'authcookie\u0000poison',
    'authcookie\u007fpoison',
    'authcookie_é',
    'authcookie with-space',
    'authcookie,forged',
    'authcookie\\forged'
  ])('rejects unsafe auth cookie value %j', async (value) => {
    await createDatabase(
      encodeCookies([{ Name: 'auth', Value: value, Domain: '.vrchat.cloud', Path: '/' }])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects cookies from a non-VRChat domain', async () => {
    await createDatabase(
      encodeCookies([{ Name: 'auth', Value: 'authcookie_primary', Domain: 'example.com' }])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects ambiguous duplicate auth cookies', async () => {
    await createDatabase(
      encodeCookies([
        { Name: 'auth', Value: 'authcookie_first', Domain: '.vrchat.cloud' },
        { Name: 'auth', Value: 'authcookie_second', Domain: 'api.vrchat.cloud' }
      ])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects cookie delimiter injection inside a stored value', async () => {
    await createDatabase(
      encodeCookies([
        {
          Name: 'auth',
          Value: 'authcookie_primary; twoFactorAuth=forged',
          Domain: '.vrchat.cloud'
        }
      ])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects a cookie collection containing malformed entries', async () => {
    await createDatabase(
      encodeCookies([{}, { Name: 'auth', Value: 'authcookie_primary', Domain: '.vrchat.cloud' }])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects an oversized SQLite cookie value before import', async () => {
    await createDatabase(
      encodeCookies([
        { Name: 'auth', Value: 'authcookie_primary', Domain: '.vrchat.cloud' },
        { Name: 'unrelated', Value: 'x'.repeat(300_000), Domain: 'example.com' }
      ])
    )

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('does not materialize an oversized non-target key while locating default', async () => {
    const path = await createDatabase()
    const database = new DatabaseSync(path)
    database.exec(
      "INSERT INTO cookies (`key`, `value`) SELECT replace(hex(zeroblob(4194304)), '00', 'AA'), 'ignored'"
    )
    database.close()

    await expect(importVrcxSession()).resolves.toBe('imported')
    expect(mocks.saveCredential).toHaveBeenCalledTimes(1)
  })

  it('rejects more than 64 cookies while accepting exactly 64', async () => {
    const auth = { Name: 'auth', Value: 'authcookie_primary', Domain: '.vrchat.cloud' }
    const unrelated = Array.from({ length: 64 }, (_, index) => ({
      Name: `unrelated-${index}`,
      Value: `value-${index}`,
      Domain: 'example.com'
    }))

    await createDatabase(encodeCookies([auth, ...unrelated.slice(0, 63)]))
    await expect(importVrcxSession()).resolves.toBe('imported')

    const database = new DatabaseSync(databasePath())
    database
      .prepare('UPDATE cookies SET `value` = ? WHERE `key` = ?')
      .run(encodeCookies([auth, ...unrelated]), 'default')
    database.close()
    mocks.saveCredential.mockClear()

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('rejects duplicate default rows in a malformed database', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    database.exec('PRAGMA journal_mode=WAL; CREATE TABLE cookies (`key` TEXT, `value` TEXT)')
    database
      .prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?), (?, ?)')
      .run('default', COOKIE_PAYLOAD, 'default', COOKIE_PAYLOAD)
    database.close()

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('accepts at most 64 rows in the external cookies table', async () => {
    const path = await createDatabase()
    const database = new DatabaseSync(path)
    const insert = database.prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?)')
    for (let index = 0; index < 63; index += 1) insert.run(`unrelated-${index}`, 'ignored')
    database.close()

    await expect(importVrcxSession()).resolves.toBe('imported')

    const oversized = new DatabaseSync(path)
    oversized
      .prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?)')
      .run('unrelated-64', 'ignored')
    oversized.close()
    mocks.saveCredential.mockClear()

    await expect(importVrcxSession()).resolves.toBeNull()
    expect(mocks.saveCredential).not.toHaveBeenCalled()
  })

  it('retries once and fails closed while the source database has an exclusive lock', async () => {
    const path = await createDatabase()
    const locker = new DatabaseSync(path)
    locker.exec('BEGIN EXCLUSIVE')

    try {
      expect((await lstat(`${path}-shm`)).size).toBeGreaterThan(0)
      await expect(importVrcxSession()).resolves.toBeNull()
      expect(mocks.copyOpenFile).not.toHaveBeenCalled()
      expect(mocks.saveCredential).not.toHaveBeenCalled()
    } finally {
      locker.exec('ROLLBACK')
      locker.close()
    }
  })

  it('removes a stale plaintext snapshot before reading VRCX', async () => {
    await createDatabase()
    const staleRoot = join(tempPath, 'vrx-vrcx-session-import-Ab12Cd')
    const staleSnapshot = join(staleRoot, 'snapshot-stale')
    await mkdir(staleSnapshot, { recursive: true })
    await writeFile(
      join(staleRoot, '.vrx-vrcx-session-import-root'),
      'VRX VRCX snapshot v1\n2147483647\n'
    )
    await writeFile(join(staleSnapshot, 'VRCX.sqlite3'), COOKIE_PAYLOAD)

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(await readdir(tempPath)).toEqual([])
  })

  it('preserves an unrelated directory that only matches the snapshot prefix', async () => {
    await createDatabase()
    const unrelatedRoot = join(tempPath, 'vrx-vrcx-session-import-Zy98Xw')
    await mkdir(unrelatedRoot)
    await writeFile(join(unrelatedRoot, 'keep.txt'), 'user data')

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(await readFile(join(unrelatedRoot, 'keep.txt'), 'utf8')).toBe('user data')
    expect(await readdir(tempPath)).toEqual(['vrx-vrcx-session-import-Zy98Xw'])
  })

  it('preserves a marked snapshot root owned by a running process', async () => {
    await createDatabase()
    const activeRoot = join(tempPath, 'vrx-vrcx-session-import-Rt56Yu')
    await mkdir(activeRoot)
    await writeFile(
      join(activeRoot, '.vrx-vrcx-session-import-root'),
      `VRX VRCX snapshot v1\n${process.pid}\n`
    )
    await writeFile(join(activeRoot, 'keep.txt'), 'active snapshot')

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(await readFile(join(activeRoot, 'keep.txt'), 'utf8')).toBe('active snapshot')
  })

  it('does not follow a planted snapshot-root symlink', async () => {
    await createDatabase()
    const attackerPath = join(rootPath, 'attacker')
    const plantedRoot = join(tempPath, 'vrx-vrcx-session-import-Qw12Er')
    await mkdir(attackerPath)
    await symlink(attackerPath, plantedRoot, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(await readdir(attackerPath)).toEqual([])
    expect(await readdir(tempPath)).toEqual(['vrx-vrcx-session-import-Qw12Er'])
  })

  it.runIf(process.platform !== 'win32')(
    'does not block on a planted FIFO snapshot marker',
    async () => {
      await createDatabase()
      const plantedRoot = join(tempPath, 'vrx-vrcx-session-import-Ff34Gg')
      const markerPath = join(plantedRoot, '.vrx-vrcx-session-import-root')
      await mkdir(plantedRoot)
      await execFileAsync('mkfifo', [markerPath])

      const operation = importVrcxSession()
      const outcome = await Promise.race([
        operation,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250))
      ])
      if (outcome === 'timeout') {
        let releaseHandle
        try {
          releaseHandle = await open(
            markerPath,
            constants.O_WRONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
          )
        } catch (error) {
          if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            error.code !== 'ENXIO'
          ) {
            throw error
          }
        }
        if (releaseHandle !== undefined) {
          try {
            await releaseHandle.writeFile(`VRX VRCX snapshot v1\n${process.pid}\n`)
          } finally {
            await releaseHandle.close()
          }
        }
        await operation
      }

      expect(outcome).toBe('imported')
      expect(await readdir(plantedRoot)).toEqual(['.vrx-vrcx-session-import-root'])
    }
  )

  it('retries when the source generation changes during the copy', async () => {
    await createDatabase(
      encodeCookies([{ Name: 'auth', Value: 'authcookie_old', Domain: '.vrchat.cloud' }])
    )
    const replacement = encodeCookies([
      { Name: 'auth', Value: 'authcookie_new', Domain: '.vrchat.cloud' }
    ])
    mocks.copyOpenFile.mockImplementationOnce(async (source, destination, sourceBytes) => {
      if (mocks.realCopyOpenFile === undefined) {
        throw new Error('snapshot copy mock was not initialized')
      }
      const copiedSnapshot = await mocks.realCopyOpenFile(source, destination, sourceBytes)
      const database = new DatabaseSync(databasePath())
      database.prepare('UPDATE cookies SET `value` = ? WHERE `key` = ?').run(replacement, 'default')
      database.close()
      return copiedSnapshot
    })

    await expect(importVrcxSession()).resolves.toBe('imported')

    expect(mocks.copyOpenFile).toHaveBeenCalledTimes(2)
    expect(mocks.saveCredential).toHaveBeenCalledWith('vrchat:primary', 'auth=authcookie_new')
  })

  it('rejects a snapshot pathname replaced after its exclusive copy', async () => {
    await createDatabase()
    const alternatePath = join(rootPath, 'alternate.sqlite3')
    const alternate = new DatabaseSync(alternatePath)
    alternate.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE cookies (`key` TEXT PRIMARY KEY, `value` TEXT)'
    )
    alternate
      .prepare('INSERT INTO cookies (`key`, `value`) VALUES (?, ?)')
      .run(
        'default',
        encodeCookies([{ Name: 'auth', Value: 'substituted_cookie', Domain: '.vrchat.cloud' }])
      )
    alternate.close()
    mocks.copyOpenFile.mockImplementation(async (source, destination, sourceBytes) => {
      return copySnapshotThen(source, destination, sourceBytes, async () => {
        await rm(destination)
        await copyFile(alternatePath, destination)
      })
    })

    await expectSingleRejectedCopy()
  })

  it('rejects a valid WAL planted beside the private snapshot before parsing', async () => {
    await createDatabase()
    mocks.copyOpenFile.mockImplementation(async (source, destination, sourceBytes) => {
      if (mocks.realCopyOpenFile === undefined) {
        throw new Error('snapshot copy mock was not initialized')
      }
      const copiedSnapshot = await mocks.realCopyOpenFile(source, destination, sourceBytes)
      const checkpointedMain = await readFile(destination)
      const attacker = new DatabaseSync(destination)
      attacker.exec('PRAGMA wal_autocheckpoint=0')
      attacker
        .prepare('UPDATE cookies SET `value` = ? WHERE `key` = ?')
        .run(
          encodeCookies([
            { Name: 'auth', Value: 'attacker_sidecar_cookie', Domain: '.vrchat.cloud' }
          ]),
          'default'
        )
      const plantedWal = await readFile(`${destination}-wal`)
      const plantedShm = await readFile(`${destination}-shm`)
      attacker.close()
      await writeFile(destination, checkpointedMain)
      await writeFile(`${destination}-wal`, plantedWal)
      await writeFile(`${destination}-shm`, plantedShm)
      const value = await copiedSnapshot.handle.stat({ bigint: true })
      return {
        handle: copiedSnapshot.handle,
        version: {
          dev: value.dev,
          ino: value.ino,
          nlink: value.nlink,
          size: value.size,
          mtimeNs: value.mtimeNs,
          ctimeNs: value.ctimeNs
        }
      }
    })

    await expectSingleRejectedCopy()
  })

  it('fails closed when the VRCX directory entry changes during every copy', async () => {
    await createDatabase()
    mocks.copyOpenFile.mockImplementation(async (source, destination, sourceBytes) => {
      return copySnapshotThen(source, destination, sourceBytes, async () => {
        const vrcxDirectory = dirname(databasePath())
        const movedDirectory = join(appDataPath, 'VRCX-moved')
        await rename(vrcxDirectory, movedDirectory)
        await rename(movedDirectory, vrcxDirectory)
      })
    })

    await expectRetryThenNull()
  })

  it('retries once after a transient sharing failure', async () => {
    await createDatabase()
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    mocks.copyOpenFile.mockRejectedValueOnce(busy)

    await expect(importVrcxSession()).resolves.toBe('imported')
    expect(mocks.copyOpenFile).toHaveBeenCalledTimes(2)
    expect(mocks.saveCredential).toHaveBeenCalledTimes(1)
  })

  it('returns null after exactly one retry when sharing remains unavailable', async () => {
    await createDatabase()
    mocks.copyOpenFile.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))

    await expectRetryThenNull()
  })

  it('rejects rollback-journal databases instead of importing uncommitted data', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    const writer = new DatabaseSync(path)
    writer.exec(
      "PRAGMA journal_mode=DELETE; CREATE TABLE cookies (`key` TEXT PRIMARY KEY, `value` TEXT); INSERT INTO cookies VALUES ('default', 'old')"
    )
    writer.exec('BEGIN IMMEDIATE')
    writer.prepare('UPDATE cookies SET `value` = ? WHERE `key` = ?').run(COOKIE_PAYLOAD, 'default')

    try {
      await expect(importVrcxSession()).resolves.toBeNull()
      expect(mocks.copyOpenFile).not.toHaveBeenCalled()
      expect(mocks.saveCredential).not.toHaveBeenCalled()
    } finally {
      writer.exec('ROLLBACK')
      writer.close()
    }
  })

  it('accepts a checkpointed database with a stale empty rollback journal', async () => {
    const path = await createDatabase()
    await writeFile(`${path}-journal`, Buffer.alloc(0))

    await expect(importVrcxSession()).resolves.toBe('imported')
    expect(mocks.copyOpenFile).toHaveBeenCalledTimes(1)
    expect(mocks.saveCredential).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized source database before copying it', async () => {
    const path = await createDatabase()
    await truncate(path, 512 * 1024 * 1024 + 1)

    await expectRejectedBeforeCopy()
  })

  it('shares one import operation across concurrent callers', async () => {
    await createDatabase()

    const first = importVrcxSession()
    const second = importVrcxSession()

    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual(['imported', 'imported'])
    expect(mocks.saveCredential).toHaveBeenCalledTimes(1)
  })
})
