import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { blake2b } from '@noble/hashes/blake2.js'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyLinuxUpdateMetadata } from './verify-linux-update-metadata.mjs'

const temporaryDirectories = []
const appImagePayload = Buffer.from('appimage fixture')

function blockMapChecksum(bytes) {
  return Buffer.from(blake2b(bytes, { dkLen: 18 })).toString('base64')
}

function blockMapForPayload({ name = 'file', checksum = blockMapChecksum(appImagePayload) } = {}) {
  return {
    version: '2',
    files: [{ name, offset: 0, checksums: [checksum], sizes: [appImagePayload.length] }]
  }
}

function appImageWithBlockMap(blockMap, payload = appImagePayload) {
  const compressedBlockMap = deflateRawSync(JSON.stringify(blockMap))
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32BE(compressedBlockMap.length)
  return {
    bytes: Buffer.concat([payload, compressedBlockMap, trailer]),
    blockMapSize: compressedBlockMap.length
  }
}

function appImageWithPayloadChunks(payload, chunks) {
  return appImageWithBlockMap(
    {
      version: '2',
      files: [
        {
          name: 'file',
          offset: 0,
          checksums: chunks.map(blockMapChecksum),
          sizes: chunks.map((chunk) => chunk.length)
        }
      ]
    },
    payload
  )
}

const validAppImage = appImageWithBlockMap(blockMapForPayload())
const appImageBlockMapSize = validAppImage.blockMapSize
const appImageBytes = validAppImage.bytes
const debBytes = Buffer.from('deb fixture')
const packageMetadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

async function createFixture({
  manifestTransform = (value) => value,
  appUpdate = null,
  appImage = appImageBytes,
  blockMapSize = appImageBlockMapSize
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vrx-linux-update-'))
  temporaryDirectories.push(directory)

  const appImageName = `${packageMetadata.name}-${packageMetadata.version}-x86_64.AppImage`
  const debName = `${packageMetadata.name}_${packageMetadata.version}_amd64.deb`
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
  const validManifest = `version: ${packageMetadata.version}
files:
  - url: ${appImageName}
    sha512: ${sha512(appImage)}
    size: ${appImage.length}
    blockMapSize: ${blockMapSize}
  - url: ${debName}
    sha512: ${sha512(debBytes)}
    size: ${debBytes.length}
path: ${appImageName}
sha512: ${sha512(appImage)}
`

  await Promise.all([
    writeFile(appImagePath, appImage),
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
        value.replace(
          `url: ${packageMetadata.name}-${packageMetadata.version}-x86_64.AppImage`,
          `url: ${packageMetadata.name}-${packageMetadata.version}-x86_64.AppImage.corrupt`
        )
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('exact AppImage entry')
  })

  it('rejects a non-numeric AppImage block-map size', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) =>
        value.replace(`blockMapSize: ${appImageBlockMapSize}`, 'blockMapSize: nonsense')
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow('positive blockMapSize')
  })

  it('rejects an AppImage block-map size that disagrees with its embedded trailer', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) =>
        value.replace(
          `blockMapSize: ${appImageBlockMapSize}`,
          `blockMapSize: ${appImageBlockMapSize + 1}`
        )
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'blockMapSize must match the AppImage trailer'
    )
  })

  it('rejects a matching trailer and manifest size larger than the available AppImage bytes', async () => {
    const oversizedBlockMapSize = appImagePayload.length + 1
    const oversizedTrailer = Buffer.alloc(4)
    oversizedTrailer.writeUInt32BE(oversizedBlockMapSize)
    const oversizedAppImage = Buffer.concat([appImagePayload, oversizedTrailer])
    const fixture = await createFixture({
      appImage: oversizedAppImage,
      blockMapSize: oversizedBlockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'block-map size cannot exceed the bytes before its trailer'
    )
  })

  it('rejects embedded block-map bytes that electron-updater cannot inflate and parse', async () => {
    const invalidBlockMap = Buffer.from('not a compressed block map')
    const invalidTrailer = Buffer.alloc(4)
    invalidTrailer.writeUInt32BE(invalidBlockMap.length)
    const invalidAppImage = Buffer.concat([appImagePayload, invalidBlockMap, invalidTrailer])
    const fixture = await createFixture({
      appImage: invalidAppImage,
      blockMapSize: invalidBlockMap.length
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map must be valid deflate-compressed JSON'
    )
  })

  it('rejects a compressed block map larger than the verifier limit', async () => {
    const compressedBlockMap = Buffer.alloc(16 * 1024 * 1024 + 1)
    const trailer = Buffer.alloc(4)
    trailer.writeUInt32BE(compressedBlockMap.length)
    const appImage = Buffer.concat([appImagePayload, compressedBlockMap, trailer])
    const fixture = await createFixture({
      appImage,
      blockMapSize: compressedBlockMap.length
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'compressed block map cannot exceed 16 MiB'
    )
  })

  it('rejects a block map whose inflated JSON exceeds the verifier limit', async () => {
    const appImage = appImageWithBlockMap({
      version: '2',
      files: [{ name: 'vrx', offset: 0, checksums: ['fixture'], sizes: [appImagePayload.length] }],
      padding: 'x'.repeat(32 * 1024 * 1024)
    })
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'inflated block map cannot exceed 32 MiB'
    )
  })

  it.each([
    ['an empty files array', { version: '2', files: [] }],
    ['a file without chunk arrays', { version: '2', files: [{ name: 'vrx', offset: 0 }] }],
    [
      'mismatched checksum and size counts',
      { version: '2', files: [{ name: 'vrx', offset: 0, checksums: ['fixture'], sizes: [] }] }
    ],
    [
      'chunk sizes that do not cover the AppImage payload',
      { version: '2', files: [{ name: 'vrx', offset: 0, checksums: ['fixture'], sizes: [1] }] }
    ]
  ])('rejects embedded block-map files with %s', async (_description, blockMap) => {
    const appImage = appImageWithBlockMap(blockMap)
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map files must describe the AppImage payload'
    )
  })

  it('rejects an embedded block-map file identity electron-builder does not emit', async () => {
    const appImage = appImageWithBlockMap(blockMapForPayload({ name: 'vrx' }))
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map files must describe the AppImage payload'
    )
  })

  it('rejects embedded block-map chunk checksums that do not match the AppImage payload', async () => {
    const appImage = appImageWithBlockMap(
      blockMapForPayload({ checksum: blockMapChecksum(Buffer.from('different payload')) })
    )
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map files must describe the AppImage payload'
    )
  })

  it('rejects non-final chunks smaller than electron-builder can emit', async () => {
    const payload = Buffer.alloc(8193)
    const chunks = [payload.subarray(0, 1), payload.subarray(1)]
    const appImage = appImageWithPayloadChunks(payload, chunks)
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map files must describe the AppImage payload'
    )
  })

  it('rejects chunks larger than electron-builder can emit', async () => {
    const payload = Buffer.alloc(32769)
    const appImage = appImageWithPayloadChunks(payload, [payload])
    const fixture = await createFixture({
      appImage: appImage.bytes,
      blockMapSize: appImage.blockMapSize
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'embedded block map files must describe the AppImage payload'
    )
  })

  it('rejects unverified extra files that electron-updater could select first', async () => {
    const fixture = await createFixture({
      manifestTransform: (value) =>
        value.replace(
          'files:\n',
          `files:\n  - url: stale-x64.AppImage\n    sha512: ${sha512(appImageBytes)}\n    size: ${appImageBytes.length}\n`
        )
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'exactly the AppImage and deb entries'
    )
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

  it('rejects an updater cache directory that does not match electron-builder', async () => {
    const fixture = await createFixture({
      appUpdate: `owner: Imperix1155
repo: VRX
provider: github
releaseType: draft
updaterCacheDirName: ../../Documents
`
    })

    await expect(verifyLinuxUpdateMetadata(fixture)).rejects.toThrow(
      'AppImage updater cache directory must match electron-builder'
    )
  })
})
