import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fileMock = vi.hoisted(() => ({
  contents: new Map<string, string>(),
  directories: new Map<string, { delayMs: number; entries: string[]; rejectAt?: number }>(),
  stalledPaths: new Set<string>(),
  stallUnknown: true,
  directoryReads: new Map<string, number>(),
  replacementInodeAfterRead: new Map<string, number>(),
  replacementCtimeAfterRead: new Set<string>(),
  changeParentCtimeOnFileOpen: new Set<string>(),
  replacementFileInode: new Map<string, number>(),
  replacedDirectories: new Set<string>(),
  openedPaths: [] as string[],
  stat(path: string, contents: string) {
    return {
      dev: 1,
      ino: path.length,
      size: Buffer.byteLength(contents),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false
    }
  },
  handle(path: string, contents: string) {
    const source = Buffer.from(contents)
    return {
      stat: () =>
        Promise.resolve({
          dev: 1,
          ino: fileMock.replacementFileInode.get(path) ?? path.length,
          size: source.length,
          isFile: () => true
        }),
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = source.copy(buffer, offset, position, position + length)
        return Promise.resolve({ bytesRead, buffer })
      },
      close: () => Promise.resolve()
    }
  }
}))

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn((path: string) => {
    const contents = fileMock.contents.get(path)
    if (contents !== undefined) return Promise.resolve(fileMock.stat(path, contents))
    const directory = fileMock.directories.get(path)
    if (directory !== undefined) {
      const replacementInode = fileMock.replacedDirectories.has(path)
        ? fileMock.replacementInodeAfterRead.get(path)
        : undefined
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              dev: 1,
              ino: replacementInode ?? path.length,
              ctimeNs:
                fileMock.replacedDirectories.has(path) &&
                fileMock.replacementCtimeAfterRead.has(path)
                  ? 2n
                  : 1n,
              size: 0,
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false
            }),
          directory.delayMs
        )
      })
    }
    if (fileMock.stallUnknown || fileMock.stalledPaths.has(path)) {
      return new Promise<never>(() => undefined)
    }
    return Promise.reject(new Error('ENOENT'))
  }),
  open: vi.fn((path: string) => {
    fileMock.openedPaths.push(path)
    const parent = dirname(path)
    if (fileMock.changeParentCtimeOnFileOpen.has(parent)) {
      fileMock.replacedDirectories.add(parent)
    }
    return Promise.resolve(fileMock.handle(path, fileMock.contents.get(path) ?? ''))
  }),
  opendir: vi.fn((path: string) => {
    const directory = fileMock.directories.get(path)
    if (directory !== undefined) {
      let index = 0
      return Promise.resolve({
        read: () => {
          fileMock.directoryReads.set(path, (fileMock.directoryReads.get(path) ?? 0) + 1)
          if (directory.rejectAt === index) {
            index += 1
            return Promise.reject(new Error('directory read failed'))
          }
          const name = directory.entries[index]
          index += 1
          if (name !== undefined && fileMock.replacementInodeAfterRead.has(path)) {
            fileMock.replacedDirectories.add(path)
          }
          return Promise.resolve(name === undefined ? null : { name, isFile: () => true })
        },
        close: () => Promise.resolve()
      })
    }
    return new Promise<never>(() => undefined)
  })
}))

import { importCvrSession } from './cvrSessionImport'

const STEAM_DATA_PATH = join(
  '/home',
  '.local',
  'share',
  'Steam',
  'steamapps',
  'common',
  'ChilloutVR',
  'ChilloutVR_Data'
)

const seedCvrxFiles = (appDataPath: string, gameRoot: string): void => {
  fileMock.contents.set(
    join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json'),
    JSON.stringify({
      FileVersion: 1,
      data: { CVRExecutable: join(gameRoot, 'ChilloutVR') }
    })
  )
  fileMock.contents.set(
    join(appDataPath, 'CVRX', 'CVRConfigs', 'credentials.json'),
    JSON.stringify({
      FileVersion: 1,
      data: { fallback: { Username: 'cvrx-user', AccessKey: 'cvrx-key' } }
    })
  )
}

const seedSteamProfile = (): void => {
  fileMock.directories.set(STEAM_DATA_PATH, {
    delayMs: 0,
    entries: ['autologin.profile']
  })
  fileMock.contents.set(
    join(STEAM_DATA_PATH, 'autologin.profile'),
    '<LoginProfile><Username>steam-user</Username><AccessKey>steam-key</AccessKey></LoginProfile>'
  )
}

const configureGameDirectory = (
  entries: string[],
  withCvrxFallback = false
): { appDataPath: string; gameDataPath: string } => {
  vi.useFakeTimers()
  fileMock.stallUnknown = false
  const appDataPath = '/app-data'
  const gameRoot = '/game'
  const gameDataPath = join(gameRoot, 'ChilloutVR_Data')
  if (withCvrxFallback) {
    seedCvrxFiles(appDataPath, gameRoot)
  } else {
    fileMock.contents.set(
      join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json'),
      JSON.stringify({
        FileVersion: 1,
        data: { CVRExecutable: join(gameRoot, 'ChilloutVR') }
      })
    )
  }
  fileMock.directories.set(gameDataPath, { delayMs: 0, entries })
  return { appDataPath, gameDataPath }
}

const runImportWithinDeadline = async (
  appDataPath: string
): Promise<Awaited<ReturnType<typeof importCvrSession>>> => {
  const startedAt = Date.now()
  const result = importCvrSession({
    appDataPath,
    homePath: '/home',
    platform: 'linux',
    environment: {}
  })
  let settledAt: number | null = null
  void result.then(() => {
    settledAt = Date.now()
  })
  await vi.advanceTimersByTimeAsync(1_000)
  const credentials = await result
  expect(settledAt).not.toBeNull()
  expect((settledAt ?? Number.POSITIVE_INFINITY) - startedAt).toBeLessThanOrEqual(1_000)
  return credentials
}

describe('CVR session import fallback deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
    fileMock.contents.clear()
    fileMock.directories.clear()
    fileMock.stalledPaths.clear()
    fileMock.stallUnknown = true
    fileMock.directoryReads.clear()
    fileMock.replacementInodeAfterRead.clear()
    fileMock.replacementCtimeAfterRead.clear()
    fileMock.changeParentCtimeOnFileOpen.clear()
    fileMock.replacementFileInode.clear()
    fileMock.replacedDirectories.clear()
    fileMock.openedPaths.length = 0
  })

  it('returns a ready CVRX session when Source A filesystem work stalls', async () => {
    vi.useFakeTimers()
    const appDataPath = '/app-data'
    fileMock.contents.set(
      join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json'),
      JSON.stringify({ FileVersion: 1, data: {} })
    )
    fileMock.contents.set(
      join(appDataPath, 'CVRX', 'CVRConfigs', 'credentials.json'),
      JSON.stringify({
        FileVersion: 1,
        data: { fallback: { Username: 'cvrx-user', AccessKey: 'cvrx-key' } }
      })
    )

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'cvrx-user',
      accessKey: 'cvrx-key'
    })
  })

  it('returns a ready game profile when the CVRX fallback read stalls', async () => {
    vi.useFakeTimers()
    fileMock.stallUnknown = false
    const appDataPath = '/app-data'
    const gameRoot = '/game'
    const gameDataPath = join(gameRoot, 'ChilloutVR_Data')
    const credentialsPath = join(appDataPath, 'CVRX', 'CVRConfigs', 'credentials.json')
    fileMock.contents.set(
      join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json'),
      JSON.stringify({
        FileVersion: 1,
        data: { CVRExecutable: join(gameRoot, 'ChilloutVR') }
      })
    )
    fileMock.stalledPaths.add(credentialsPath)
    fileMock.directories.set(gameDataPath, {
      delayMs: 300,
      entries: ['autologin.profile']
    })
    fileMock.contents.set(
      join(gameDataPath, 'autologin.profile'),
      '<LoginProfile><Username>game-user</Username><AccessKey>game-key</AccessKey></LoginProfile>'
    )

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'game-user',
      accessKey: 'game-key'
    })
  })

  it('discovers a Steam game profile while CVRX configuration stalls', async () => {
    vi.useFakeTimers()
    fileMock.stallUnknown = false
    const appDataPath = '/app-data'
    const configPath = join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json')
    const gameDataPath = join(
      '/home',
      '.local',
      'share',
      'Steam',
      'steamapps',
      'common',
      'ChilloutVR',
      'ChilloutVR_Data'
    )
    fileMock.stalledPaths.add(configPath)
    fileMock.directories.set(gameDataPath, {
      delayMs: 300,
      entries: ['autologin.profile']
    })
    fileMock.contents.set(
      join(gameDataPath, 'autologin.profile'),
      '<LoginProfile><Username>steam-user</Username><AccessKey>steam-key</AccessKey></LoginProfile>'
    )

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'steam-user',
      accessKey: 'steam-key'
    })
  })

  it('stops directory enumeration at the first over-budget entry', async () => {
    const { appDataPath, gameDataPath } = configureGameDirectory(
      Array.from({ length: 1_000 }, (_value, index) => `noise-${index}.txt`),
      true
    )
    seedSteamProfile()

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'cvrx-user',
      accessKey: 'cvrx-key'
    })
    expect(fileMock.directoryReads.get(gameDataPath)).toBe(513)
  })

  it('rejects profiles when the parent directory changes after enumeration', async () => {
    const { appDataPath, gameDataPath } = configureGameDirectory(['autologin.profile'])
    const profilePath = join(gameDataPath, 'autologin.profile')
    fileMock.contents.set(
      profilePath,
      '<LoginProfile><Username>replacement-user</Username><AccessKey>replacement-key</AccessKey></LoginProfile>'
    )
    fileMock.replacementInodeAfterRead.set(gameDataPath, gameDataPath.length + 1)

    await expect(runImportWithinDeadline(appDataPath)).resolves.toBeNull()
    expect(fileMock.openedPaths).not.toContain(profilePath)
  })

  it('rejects a restored parent inode whose change time reveals an ABA swap', async () => {
    const { appDataPath, gameDataPath } = configureGameDirectory(['autologin.profile'])
    const profilePath = join(gameDataPath, 'autologin.profile')
    fileMock.contents.set(
      profilePath,
      '<LoginProfile><Username>replacement-user</Username><AccessKey>replacement-key</AccessKey></LoginProfile>'
    )
    fileMock.replacementCtimeAfterRead.add(gameDataPath)
    fileMock.changeParentCtimeOnFileOpen.add(gameDataPath)

    await expect(runImportWithinDeadline(appDataPath)).resolves.toBeNull()
    expect(fileMock.openedPaths).toContain(profilePath)
  })

  it('invalidates Source A when a profile changes between inspection and open', async () => {
    const { appDataPath, gameDataPath } = configureGameDirectory(
      ['autologin-a.profile', 'autologin-b.profile'],
      true
    )
    fileMock.contents.set(
      join(gameDataPath, 'autologin-a.profile'),
      '<LoginProfile><Username>game-a</Username><AccessKey>game-key-a</AccessKey></LoginProfile>'
    )
    const replacedProfile = join(gameDataPath, 'autologin-b.profile')
    fileMock.contents.set(
      replacedProfile,
      '<LoginProfile><Username>game-b</Username><AccessKey>game-key-b</AccessKey></LoginProfile>'
    )
    fileMock.replacementFileInode.set(replacedProfile, replacedProfile.length + 1)

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'cvrx-user',
      accessKey: 'cvrx-key'
    })
  })

  it('falls back when a later Source A directory read fails', async () => {
    vi.useFakeTimers()
    fileMock.stallUnknown = false
    const appDataPath = '/app-data'
    const configuredRoot = '/game'
    const configuredDataPath = join(configuredRoot, 'ChilloutVR_Data')
    seedCvrxFiles(appDataPath, configuredRoot)
    seedSteamProfile()
    fileMock.directories.set(configuredDataPath, {
      delayMs: 0,
      entries: ['unread.profile'],
      rejectAt: 0
    })

    await expect(runImportWithinDeadline(appDataPath)).resolves.toEqual({
      username: 'cvrx-user',
      accessKey: 'cvrx-key'
    })
  })
})
