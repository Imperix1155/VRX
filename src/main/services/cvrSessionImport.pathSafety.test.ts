import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMock = vi.hoisted(() => ({
  contents: new Map<string, string>(),
  inspectedPaths: [] as string[]
}))

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn((path: string) => {
    fileMock.inspectedPaths.push(path)
    const contents = fileMock.contents.get(path)
    if (contents === undefined) return Promise.reject(new Error('ENOENT'))
    return Promise.resolve({
      dev: 1,
      ino: path.length,
      size: Buffer.byteLength(contents),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false
    })
  }),
  open: vi.fn((path: string) => {
    const contents = Buffer.from(fileMock.contents.get(path) ?? '')
    return Promise.resolve({
      stat: () =>
        Promise.resolve({
          dev: 1,
          ino: path.length,
          size: contents.length,
          isFile: () => true
        }),
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = contents.copy(buffer, offset, position, position + length)
        return Promise.resolve({ bytesRead, buffer })
      },
      close: () => Promise.resolve()
    })
  }),
  opendir: vi.fn(() => Promise.reject(new Error('not a directory')))
}))

import { importCvrSession } from './cvrSessionImport'

describe('CVR session import path authority', () => {
  const windowsSeparator = String.fromCharCode(92)
  const windowsNetworkPrefix = windowsSeparator.repeat(2)
  const unsafeAppDataRoots = [
    ['a UNC path', [`${windowsNetworkPrefix}attacker`, 'share'].join(windowsSeparator)],
    ['a device path', [`${windowsNetworkPrefix}?`, 'C:', 'redirected'].join(windowsSeparator)]
  ] as const

  beforeEach(() => {
    fileMock.contents.clear()
    fileMock.inspectedPaths.length = 0
  })

  it.each(unsafeAppDataRoots)(
    'never inspects an app-data root supplied as %s',
    async (_label, appDataPath) => {
      await expect(
        importCvrSession({
          appDataPath,
          homePath: ['C:', 'Users', 'test'].join(windowsSeparator),
          platform: 'win32',
          environment: {}
        })
      ).resolves.toBeNull()

      expect(fileMock.inspectedPaths).toEqual([])
    }
  )

  it('never inspects UNC or device paths supplied by CVRX or Steam metadata', async () => {
    const appDataPath = '/app-data'
    const homePath = '/home'
    const programFiles = ['C:', 'Program Files'].join(windowsSeparator)
    const uncExecutable = [`${windowsNetworkPrefix}attacker`, 'share', 'ChilloutVR.exe'].join(
      windowsSeparator
    )
    const uncLibrary = [`${windowsNetworkPrefix}attacker`, 'share'].join(windowsSeparator)
    const deviceLibrary = [`${windowsNetworkPrefix}?`, 'C:', 'device'].join(windowsSeparator)
    const malformedEscapeLibrary = ['C:', 'unsafe', 'q'].join(windowsSeparator)
    const escapeVdfPath = (path: string): string =>
      path.replaceAll(windowsSeparator, windowsSeparator.repeat(2))
    fileMock.contents.set(
      join(appDataPath, 'CVRX', 'CVRConfigs', 'config.json'),
      JSON.stringify({
        FileVersion: 1,
        data: { CVRExecutable: uncExecutable }
      })
    )
    fileMock.contents.set(
      join(programFiles, 'Steam', 'steamapps', 'libraryfolders.vdf'),
      `"path" "${escapeVdfPath(uncLibrary)}"\n"path" "${escapeVdfPath(deviceLibrary)}"\n"path" "${malformedEscapeLibrary}"`
    )

    await expect(
      importCvrSession({
        appDataPath,
        homePath,
        platform: 'win32',
        environment: { ProgramFiles: programFiles }
      })
    ).resolves.toBeNull()

    const normalizedPaths = fileMock.inspectedPaths.map((path) => path.replaceAll('/', '\\'))
    expect(normalizedPaths).not.toContainEqual(expect.stringMatching(/^\\\\/))
    expect(normalizedPaths).not.toContainEqual(expect.stringContaining(malformedEscapeLibrary))
  })
})
