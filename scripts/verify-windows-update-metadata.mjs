import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load } from 'js-yaml'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function sha512File(path) {
  const hash = createHash('sha512')

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }

  return hash.digest('base64')
}

// The Windows manifest must point the updater at this exact setup installer.
export async function verifyWindowsUpdateMetadata({ manifestPath, setupPath }) {
  const [packageMetadata, manifest, setupStat, setupDigest] = await Promise.all([
    readFile(packagePath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(load),
    stat(setupPath),
    sha512File(setupPath)
  ])
  const setupName = basename(setupPath)

  requireCondition(
    typeof manifest === 'object' && manifest !== null,
    'Windows update manifest must be a YAML mapping'
  )
  requireCondition(
    manifest.version === packageMetadata.version,
    'Windows update manifest version must match package.json'
  )
  requireCondition(
    Array.isArray(manifest.files) && manifest.files.length === 1,
    'Windows update manifest files must contain exactly the setup installer'
  )
  const [entry] = manifest.files
  requireCondition(
    entry?.url === setupName,
    'Windows update manifest must name the setup installer'
  )
  requireCondition(entry.size === setupStat.size, 'setup installer size must match the manifest')
  requireCondition(entry.sha512 === setupDigest, 'setup installer sha512 must match the manifest')
  requireCondition(
    manifest.path === setupName && manifest.sha512 === setupDigest,
    'Windows update manifest path and top-level sha512 must match the setup installer'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, setupPath] = process.argv.slice(2)
  requireCondition(
    manifestPath && setupPath,
    'Usage: node scripts/verify-windows-update-metadata.mjs <manifest> <setup.exe>'
  )
  await verifyWindowsUpdateMetadata({ manifestPath, setupPath })
}
