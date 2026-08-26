import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const assertPackagedFonts = require('./assert-packaged-fonts.cjs')
const fontSourceDirectory = resolve(
  import.meta.dirname,
  '..',
  'src',
  'renderer',
  'src',
  'assets',
  'fonts'
)

describe('packaged font ASAR paths', () => {
  it('finds renderer fonts when ASAR lists Windows-style paths', () => {
    expect(
      assertPackagedFonts.packagedFontEntries([
        '\\out\\renderer\\assets\\inter-latin-wght-normal-example.woff2',
        '\\out\\renderer\\assets\\vt323-latin-400-normal-example.woff2',
        '\\out\\renderer\\assets\\index-example.js'
      ])
    ).toEqual([
      {
        archivePath: 'out\\renderer\\assets\\inter-latin-wght-normal-example.woff2',
        normalizedPath: 'out/renderer/assets/inter-latin-wght-normal-example.woff2'
      },
      {
        archivePath: 'out\\renderer\\assets\\vt323-latin-400-normal-example.woff2',
        normalizedPath: 'out/renderer/assets/vt323-latin-400-normal-example.woff2'
      }
    ])
  })

  it('verifies Windows-style ASAR paths through the production afterPack hook', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'vrx-packaged-fonts-'))

    try {
      const resources = join(appOutDir, 'resources')
      const packagedLicenses = join(resources, 'licenses', 'fonts')
      const manifestPath = join(fontSourceDirectory, 'SOURCES.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const fontBytesByArchivePath = new Map()
      const archiveEntries = []

      await mkdir(packagedLicenses, { recursive: true })
      await copyFile(manifestPath, join(packagedLicenses, 'SOURCES.json'))

      for (const source of Object.values(manifest.fonts)) {
        const sourceFont = join(fontSourceDirectory, source.fontFile)
        const stem = basename(source.fontFile, '.woff2')
        const archivePath = `out\\renderer\\assets\\${stem}-test.woff2`
        archiveEntries.push(`\\${archivePath}`)
        fontBytesByArchivePath.set(archivePath, await readFile(sourceFont))
        await copyFile(
          join(fontSourceDirectory, source.licenseFile),
          join(packagedLicenses, source.licenseFile)
        )
      }

      const windowsAsar = {
        listPackage: () => archiveEntries,
        extractFile: (_appAsar, archivePath) => {
          const bytes = fontBytesByArchivePath.get(archivePath)
          if (!bytes) throw new Error(`unexpected ASAR extraction path: ${archivePath}`)
          return bytes
        }
      }

      await expect(assertPackagedFonts({ appOutDir }, windowsAsar)).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })
})
