import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyLinuxUpdateMetadata } from './verify-linux-update-metadata.mjs'

const temporaryDirectories = []
const appImageBytes = Buffer.from('appimage fixture')
const debBytes = Buffer.from('deb fixture')

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

async function createFixture({ manifestTransform = (value) => value, appUpdate = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vrx-linux-update-'))
  temporaryDirectories.push(directory)

  const appImageName = 'vrx-0.18.1-x86_64.AppImage'
  const debName = 'vrx_0.18.1_amd64.deb'
  const appImagePath = join(directory, appImageName)
  const debPath = join(directory, debName)
  const manifestPath = join(directory, 'latest-linux.yml')
  const appImageUpdatePath = join(directory, 'appimage-update.yml')
  const debUpdatePath = join(directory, 'deb-update.yml')
  const validUpdate = `owner: Imperix1155
repo: VRX
provider: github
releaseType: draft
updaterCacheDirName: vrx-updater
`
  const validManifest = `version: 0.18.1
files:
  - url: ${appImageName}
    sha512: ${sha512(appImageBytes)}
    size: ${appImageBytes.length}
    blockMapSize: 137078
  - url: ${debName}
    sha512: ${sha512(debBytes)}
    size: ${debBytes.length}
path: ${appImageName}
sha512: ${sha512(appImageBytes)}
`

  await Promise.all([
    writeFile(appImagePath, appImageBytes),
    writeFile(debPath, debBytes),
    writeFile(manifestPath, manifestTransform(validManifest)),
    writeFile(appImageUpdatePath, appUpdate ?? validUpdate),
    writeFile(debUpdatePath, validUpdate)
  ])

  return { manifestPath, appImagePath, debPath, appImageUpdatePath, debUpdatePath }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('verifyLinuxUpdateMetadata', () => {
  it('accepts exact update metadata whose sizes and SHA-512 digests match both packages', async () => {
    await expect(verifyLinuxUpdateMetadata(await createFixture())).resolves.toBeUndefined()
  })

  it('rejects an AppImage URL that only starts with the expected artifact name', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) =>
        value.replace('url: vrx-0.18.1-x86_64.AppImage', 'url: vrx-0.18.1-x86_64.AppImage.corrupt')
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('exact AppImage entry')
  })

  it('rejects a non-numeric AppImage block-map size', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) => value.replace('blockMapSize: 137078', 'blockMapSize: nonsense')
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('positive blockMapSize')
  })

  it('rejects a manifest digest that does not match the AppImage bytes', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) => value.replaceAll(sha512(appImageBytes), 'invalid-digest')
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('AppImage sha512')
  })

  it('rejects an empty packaged updater configuration', async () => {
    const fixture = await createFixture({ appUpdate: '' })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('AppImage updater provider')
  })
})
