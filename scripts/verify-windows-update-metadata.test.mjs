import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsUpdateMetadata } from './verify-windows-update-metadata.mjs'

const temporaryDirectories = []
const setupBytes = Buffer.from('setup fixture')
const { name, version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)
const setupName = `${name}-${version}-setup.exe`
const digest = createHash('sha512').update(setupBytes).digest('base64')
const validManifest = `version: ${version}
files:
  - url: ${setupName}
    sha512: ${digest}
    size: ${setupBytes.length}
path: ${setupName}
sha512: ${digest}
`

async function createFixture(manifest = validManifest) {
  const directory = await mkdtemp(join(tmpdir(), 'vrx-windows-update-'))
  temporaryDirectories.push(directory)
  const manifestPath = join(directory, 'latest.yml')
  const setupPath = join(directory, setupName)
  await Promise.all([writeFile(manifestPath, manifest), writeFile(setupPath, setupBytes)])
  return { manifestPath, setupPath }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('verifyWindowsUpdateMetadata', () => {
  it('accepts a manifest naming this version and the exact setup installer', async () => {
    await expect(verifyWindowsUpdateMetadata(await createFixture())).resolves.toBeUndefined()
  })

  it.each([
    ['another version', `version: ${version}`, 'version: 0.0.1', 'version must match'],
    ['another installer', `url: ${setupName}`, 'url: other-setup.exe', 'name the setup installer'],
    ['a wrong size', `size: ${setupBytes.length}`, 'size: 1', 'size must match'],
    ['a wrong entry digest', `    sha512: ${digest}`, '    sha512: wrong', 'sha512 must match'],
    ['a wrong top-level digest', `\nsha512: ${digest}`, '\nsha512: wrong', 'top-level sha512'],
    ['a wrong top-level path', `path: ${setupName}`, 'path: other-setup.exe', 'top-level sha512']
  ])('rejects %s', async (_label, from, to, message) => {
    const fixture = await createFixture(validManifest.replace(from, to))
    await expect(verifyWindowsUpdateMetadata(fixture)).rejects.toThrow(message)
  })
})
