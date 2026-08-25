import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importCvrSession,
  loadStoredOrImportedCvrSession,
  type CvrSessionImportPaths
} from './cvrSessionImport'

const temporaryDirectories: string[] = []
const windowsSeparator = String.fromCharCode(92)
const windowsNetworkPrefix = windowsSeparator.repeat(2)
const unsafeWindowsPaths = {
  uncExecutable: [`${windowsNetworkPrefix}attacker`, 'share', 'ChilloutVR.exe'].join(
    windowsSeparator
  ),
  deviceExecutable: [`${windowsNetworkPrefix}?`, 'C:', 'ChilloutVR', 'ChilloutVR.exe'].join(
    windowsSeparator
  )
}

const makePaths = (platform: NodeJS.Platform = 'linux'): CvrSessionImportPaths => {
  const root = mkdtempSync(join(tmpdir(), 'vrx-cvr-import-'))
  temporaryDirectories.push(root)
  return {
    appDataPath: join(root, 'app-data'),
    homePath: join(root, 'home'),
    platform,
    environment: {}
  }
}

const writeText = (path: string, contents: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

const cvrxConfigPath = (paths: CvrSessionImportPaths): string =>
  join(paths.appDataPath, 'CVRX', 'CVRConfigs', 'config.json')

const cvrxCredentialsPath = (paths: CvrSessionImportPaths): string =>
  join(paths.appDataPath, 'CVRX', 'CVRConfigs', 'credentials.json')

const cvrxFallback = { username: 'cvrx-user', accessKey: 'cvrx-key' }

const writeCvrxFallback = (paths: CvrSessionImportPaths): void => {
  writeText(
    cvrxCredentialsPath(paths),
    JSON.stringify({
      FileVersion: 1,
      data: {
        fallback: { Username: cvrxFallback.username, AccessKey: cvrxFallback.accessKey }
      }
    })
  )
}

const profileXml = (username: string, accessKey: string): string =>
  `<LoginProfile><Username>${username}</Username><AccessKey>${accessKey}</AccessKey></LoginProfile>`

const writeConfiguredGameProfile = (
  paths: CvrSessionImportPaths,
  contents: string,
  profileName = 'autologin.profile'
): void => {
  const gameRoot = join(paths.homePath, 'game')
  writeText(
    cvrxConfigPath(paths),
    JSON.stringify({ FileVersion: 1, data: { CVRExecutable: join(gameRoot, 'ChilloutVR.exe') } })
  )
  writeText(join(gameRoot, 'ChilloutVR_Data', profileName), contents)
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('CVR session import', () => {
  it('prefers a game auto-login profile over CVRX stored credentials', async () => {
    const paths = makePaths('win32')
    const gameRoot = join(paths.homePath, 'custom-game')
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: {
          ActiveUsername: 'cvrx-user',
          CVRExecutable: join(gameRoot, 'ChilloutVR.exe')
        }
      })
    )
    writeText(
      join(gameRoot, 'ChilloutVR_Data', 'autologin.profile'),
      profileXml('game-user', 'game-access-key')
    )
    writeText(
      cvrxCredentialsPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: { fallback: { Username: 'cvrx-user', AccessKey: 'cvrx-access-key', ImageUrl: 'x' } }
      })
    )

    expect(await importCvrSession(paths)).toEqual({
      username: 'game-user',
      accessKey: 'game-access-key'
    })
  })

  it('finds a game profile without CVRX through Steam library metadata', async () => {
    const paths = makePaths()
    const steamRoot = join(paths.homePath, '.local', 'share', 'Steam')
    const customLibrary = join(paths.homePath, 'games', 'steam-library')
    writeText(
      join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders" { "0" { "path" "${customLibrary}" } }`
    )
    writeText(
      join(
        customLibrary,
        'steamapps',
        'common',
        'ChilloutVR',
        'ChilloutVR_Data',
        'autologin-main.profile'
      ),
      profileXml('steam-user', 'steam-access-key')
    )

    expect(await importCvrSession(paths)).toEqual({
      username: 'steam-user',
      accessKey: 'steam-access-key'
    })
  })

  it('decodes standard XML entities before applying credential validation', async () => {
    const paths = makePaths('win32')
    writeConfiguredGameProfile(
      paths,
      `<?xml version="1.0" encoding="utf-8"?>${profileXml('user&amp;friend', 'key&amp;value')}`
    )

    expect(await importCvrSession(paths)).toEqual({
      username: 'user&friend',
      accessKey: 'key&value'
    })
  })

  it('falls back to the CVRX active username when multiple credentials exist', async () => {
    const paths = makePaths()
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({ FileVersion: 1, data: { ActiveUsername: 'selected-user' } })
    )
    writeText(
      cvrxCredentialsPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: {
          first: { Username: 'other-user', AccessKey: 'other-key', ImageUrl: 'ignored' },
          second: { Username: 'selected-user', AccessKey: 'selected-key', Password: 'ignored' }
        }
      })
    )

    expect(await importCvrSession(paths)).toEqual({
      username: 'selected-user',
      accessKey: 'selected-key'
    })
  })

  it('returns null instead of choosing between ambiguous saved sessions', async () => {
    const paths = makePaths()
    writeText(
      cvrxCredentialsPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: {
          first: { Username: 'first-user', AccessKey: 'first-key' },
          second: { Username: 'second-user', AccessKey: 'second-key' }
        }
      })
    )

    expect(await importCvrSession(paths)).toBeNull()
  })

  it('returns null for conflicting game profiles instead of selecting by directory order', async () => {
    const paths = makePaths('win32')
    const gameRoot = join(paths.homePath, 'game')
    writeConfiguredGameProfile(paths, profileXml('first-user', 'first-key'), 'autologin-a.profile')
    writeText(
      join(gameRoot, 'ChilloutVR_Data', 'autologin-b.profile'),
      profileXml('second-user', 'second-key')
    )

    expect(await importCvrSession(paths)).toBeNull()
  })

  it('uses CVRX ActiveUsername only to disambiguate multiple game profiles', async () => {
    const paths = makePaths('win32')
    const gameRoot = join(paths.homePath, 'game')
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: {
          ActiveUsername: 'second-user',
          CVRExecutable: join(gameRoot, 'ChilloutVR.exe')
        }
      })
    )
    writeText(
      join(gameRoot, 'ChilloutVR_Data', 'autologin-a.profile'),
      profileXml('first-user', 'first-key')
    )
    writeText(
      join(gameRoot, 'ChilloutVR_Data', 'autologin-b.profile'),
      profileXml('second-user', 'second-key')
    )

    expect(await importCvrSession(paths)).toEqual({
      username: 'second-user',
      accessKey: 'second-key'
    })
  })

  it.each([
    ['malformed XML', '<LoginProfile><Username>user</Username>'],
    [
      'mismatched XML nesting',
      '<LoginProfile><Broken><Username>user</Username></Nope><AccessKey>key</AccessKey></LoginProfile>'
    ],
    ['an external entity', '<!DOCTYPE x [<!ENTITY key "secret">]>' + profileXml('user', '&key;')],
    ['a control character entity', profileXml('user&#13;Injected', 'key')],
    ['a non-ASCII access key', profileXml('user', 'key-☃')]
  ])('rejects %s in a game profile', async (_label, contents) => {
    const paths = makePaths('win32')
    writeConfiguredGameProfile(paths, contents)

    expect(await importCvrSession(paths)).toBeNull()
  })

  it('ignores malformed and oversized CVRX files', async () => {
    const malformedPaths = makePaths()
    writeText(cvrxCredentialsPath(malformedPaths), '{not-json')

    const oversizedPaths = makePaths()
    writeText(cvrxCredentialsPath(oversizedPaths), ' '.repeat(1_048_577))

    expect(await importCvrSession(malformedPaths)).toBeNull()
    expect(await importCvrSession(oversizedPaths)).toBeNull()
  })

  it('rejects a relative executable path that could escape the CVRX directory', async () => {
    const paths = makePaths('win32')
    const gameRoot = join(paths.homePath, 'outside')
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: {
          CVRExecutable: relative(process.cwd(), join(gameRoot, 'ChilloutVR.exe'))
        }
      })
    )
    writeText(
      join(gameRoot, 'ChilloutVR_Data', 'autologin.profile'),
      profileXml('escaped-user', 'escaped-key')
    )

    expect(await importCvrSession(paths)).toBeNull()
  })

  it.each([
    ['a UNC path', unsafeWindowsPaths.uncExecutable],
    ['a Windows device path', unsafeWindowsPaths.deviceExecutable]
  ])('rejects %s before automatic game discovery', async (_label, executablePath) => {
    const paths = makePaths('win32')
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({ FileVersion: 1, data: { CVRExecutable: executablePath } })
    )

    expect(await importCvrSession(paths)).toBeNull()
  })

  it('falls back to CVRX when the global profile-file budget is exceeded', async () => {
    const paths = makePaths()
    const gameRoot = join(paths.homePath, 'game')
    writeText(
      cvrxConfigPath(paths),
      JSON.stringify({
        FileVersion: 1,
        data: { CVRExecutable: join(gameRoot, 'ChilloutVR.exe') }
      })
    )
    for (let index = 0; index < 33; index += 1) {
      writeText(
        join(gameRoot, 'ChilloutVR_Data', `autologin-${index}.profile`),
        profileXml('same-user', 'same-key')
      )
    }
    writeText(
      join(
        paths.homePath,
        '.local',
        'share',
        'Steam',
        'steamapps',
        'common',
        'ChilloutVR',
        'ChilloutVR_Data',
        'autologin.profile'
      ),
      profileXml('later-game-user', 'later-game-key')
    )
    writeCvrxFallback(paths)

    expect(await importCvrSession(paths)).toEqual(cvrxFallback)
  })

  it('falls back to CVRX when Steam metadata exceeds the game-directory budget', async () => {
    const paths = makePaths()
    const steamRoot = join(paths.homePath, '.local', 'share', 'Steam')
    const libraries = Array.from({ length: 17 }, (_value, index) =>
      join(paths.homePath, 'libraries', String(index))
    )
    writeText(
      join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
      libraries.map((library) => `"${library}" { "path" "${library}" }`).join('\n')
    )
    writeText(
      join(
        libraries[0] ?? '',
        'steamapps',
        'common',
        'ChilloutVR',
        'ChilloutVR_Data',
        'autologin.profile'
      ),
      profileXml('budget-user', 'budget-key')
    )
    writeCvrxFallback(paths)

    expect(await importCvrSession(paths)).toEqual(cvrxFallback)
  })

  it('returns null when neither source is present', async () => {
    expect(await importCvrSession(makePaths())).toBeNull()
  })
})

describe('CVR import persistence boundary', () => {
  it('persists an imported session before returning it for adapter use', async () => {
    const events: string[] = []

    const result = await loadStoredOrImportedCvrSession({
      loadStored: () => undefined,
      importSession: async () => {
        events.push('import')
        return { username: 'user', accessKey: 'key' }
      },
      persistImported: () => events.push('persist')
    })
    events.push('returned')

    expect(result).toEqual({ username: 'user', accessKey: 'key' })
    expect(events).toEqual(['import', 'persist', 'returned'])
  })

  it('does not return imported credentials when encrypted persistence fails', async () => {
    await expect(
      loadStoredOrImportedCvrSession({
        loadStored: () => undefined,
        importSession: async () => ({ username: 'user', accessKey: 'key' }),
        persistImported: () => {
          throw new Error('safeStorage unavailable')
        }
      })
    ).rejects.toThrow('safeStorage unavailable')
  })

  it('never imports when VRX already has a stored session', async () => {
    let imported = false

    expect(
      await loadStoredOrImportedCvrSession({
        loadStored: () => ({ username: 'stored-user', accessKey: 'stored-key' }),
        importSession: async () => {
          imported = true
          return { username: 'external-user', accessKey: 'external-key' }
        },
        persistImported: () => undefined
      })
    ).toEqual({ username: 'stored-user', accessKey: 'stored-key' })
    expect(imported).toBe(false)
  })
})
