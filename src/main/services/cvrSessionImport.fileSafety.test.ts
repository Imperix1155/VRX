import { describe, expect, it, vi } from 'vitest'

const read = vi.fn((buffer: Buffer) => Promise.resolve({ bytesRead: 0, buffer }))
const close = vi.fn(() => Promise.resolve())

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(() =>
    Promise.resolve({
      dev: 1,
      ino: 1,
      size: 10,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false
    })
  ),
  open: vi.fn(() =>
    Promise.resolve({
      stat: () =>
        Promise.resolve({
          dev: 1,
          ino: 2,
          size: 10,
          isFile: () => true
        }),
      read,
      close
    })
  ),
  opendir: vi.fn(() => Promise.reject(new Error('not a directory')))
}))

import { importCvrSession } from './cvrSessionImport'

describe('CVR session import file identity', () => {
  it('does not read a file replaced between path inspection and handle open', async () => {
    await expect(
      importCvrSession({
        appDataPath: '/app-data',
        homePath: '/home',
        platform: 'linux',
        environment: {}
      })
    ).resolves.toBeNull()

    expect(read).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})
