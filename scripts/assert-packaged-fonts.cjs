// electron-builder afterPack hook for VRX-32.
//
// Build output proves the CSS references emitted WOFF2 assets. This hook closes
// the packaging gap by proving those exact font bytes are in app.asar and their
// OFL notices plus pinned provenance ship beside it in Resources/licenses/fonts.
// electron-builder loads hook files with CommonJS, so this file intentionally
// uses require rather than the ESM imports used by the application sources.
/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require('node:crypto')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const asar = require('@electron/asar')

const manifestPath = join(
  __dirname,
  '..',
  'src',
  'renderer',
  'src',
  'assets',
  'fonts',
  'SOURCES.json'
)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function resourcesDirectory(appOutDir) {
  const direct = join(appOutDir, 'resources')
  if (existsSync(direct)) return direct

  const appBundle = readdirSync(appOutDir, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.endsWith('.app')
  )
  if (appBundle) return join(appOutDir, appBundle.name, 'Contents', 'Resources')

  throw new Error(`assert-packaged-fonts: cannot find Resources under ${appOutDir}`)
}

module.exports = async function assertPackagedFonts(context) {
  const resources = resourcesDirectory(context.appOutDir)
  const appAsar = join(resources, 'app.asar')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entries = asar.listPackage(appAsar).map((entry) => entry.replace(/^\//, ''))
  const packagedFonts = entries.filter(
    (entry) => entry.startsWith('out/renderer/assets/') && entry.endsWith('.woff2')
  )

  if (packagedFonts.length !== Object.keys(manifest.fonts).length) {
    throw new Error(
      `assert-packaged-fonts: expected exactly ${Object.keys(manifest.fonts).length} renderer WOFF2 files in app.asar, found ${packagedFonts.length}`
    )
  }

  for (const [family, source] of Object.entries(manifest.fonts)) {
    const stem = source.fontFile.replace(/\.woff2$/, '')
    const asarPath = packagedFonts.find((entry) => entry.includes(`/${stem}-`))
    if (!asarPath) {
      throw new Error(`assert-packaged-fonts: app.asar is missing ${family} (${stem}-*.woff2)`)
    }
    if (sha256(asar.extractFile(appAsar, asarPath)) !== source.fontSha256) {
      throw new Error(`assert-packaged-fonts: packaged ${family} bytes do not match SOURCES.json`)
    }

    const packagedLicense = join(resources, 'licenses', 'fonts', source.licenseFile)
    if (sha256(readFileSync(packagedLicense)) !== source.licenseSha256) {
      throw new Error(
        `assert-packaged-fonts: packaged ${family} OFL notice does not match SOURCES.json`
      )
    }
  }

  const packagedManifest = join(resources, 'licenses', 'fonts', 'SOURCES.json')
  if (sha256(readFileSync(packagedManifest)) !== sha256(readFileSync(manifestPath))) {
    throw new Error('assert-packaged-fonts: packaged provenance manifest does not match the source')
  }

  console.log('assert-packaged-fonts: OK — app.asar fonts and packaged OFL provenance verified')
}
