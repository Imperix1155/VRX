import { link, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyOpenFile } from './vrcxSnapshotCopy'

describe('VRCX snapshot copy', () => {
  let rootPath: string

  async function expectProtectedDestination(
    plantDestination: (protectedPath: string, destinationPath: string) => Promise<void>
  ): Promise<void> {
    const sourcePath = join(rootPath, 'source.sqlite3')
    const protectedPath = join(rootPath, 'protected.sqlite3')
    const destinationPath = join(rootPath, 'snapshot.sqlite3')
    await writeFile(sourcePath, 'source data')
    await writeFile(protectedPath, 'protected data')
    await plantDestination(protectedPath, destinationPath)
    const source = await open(sourcePath, 'r')

    try {
      await expect(copyOpenFile(source, destinationPath, 11)).rejects.toMatchObject({
        code: 'EEXIST'
      })
    } finally {
      await source.close()
    }

    expect(await readFile(protectedPath, 'utf8')).toBe('protected data')
  }

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'vrx-vrcx-copy-'))
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('refuses to overwrite a planted destination hard link', async () => {
    await expectProtectedDestination(link)
  })

  it.runIf(process.platform !== 'win32')(
    'refuses to follow a planted destination symlink',
    async () => {
      await expectProtectedDestination(symlink)
    }
  )

  it.runIf(process.platform !== 'win32')(
    'copies from the opened source after its pathname is replaced',
    async () => {
      const sourcePath = join(rootPath, 'source.sqlite3')
      const openedPath = join(rootPath, 'opened.sqlite3')
      const destinationPath = join(rootPath, 'snapshot.sqlite3')
      await writeFile(sourcePath, 'opened bytes')
      const source = await open(sourcePath, 'r')
      await rename(sourcePath, openedPath)
      await writeFile(sourcePath, 'swapped data')

      try {
        const snapshot = await copyOpenFile(source, destinationPath, 12)
        await snapshot.handle.close()
      } finally {
        await source.close()
      }

      expect(await readFile(destinationPath, 'utf8')).toBe('opened bytes')
    }
  )
})
