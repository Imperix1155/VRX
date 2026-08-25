import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { blake2b } from '@noble/hashes/blake2.js'
import { load } from 'js-yaml'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const builderConfigPath = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))
const maxCompressedBlockMapBytes = 16 * 1024 * 1024
const maxInflatedBlockMapBytes = 32 * 1024 * 1024
const minBlockMapChunkBytes = 8 * 1024
const maxBlockMapChunkBytes = 32 * 1024
const blockMapReadBufferBytes = 1024 * 1024

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function blockMapFileDescribesPayload(handle, value, payloadSize) {
  if (
    !isRecord(value) ||
    value.name !== 'file' ||
    value.offset !== 0 ||
    !Array.isArray(value.checksums) ||
    !Array.isArray(value.sizes) ||
    value.checksums.length === 0 ||
    value.checksums.length !== value.sizes.length
  ) {
    return false
  }

  let describedSize = 0
  for (let index = 0; index < value.checksums.length; index += 1) {
    const checksum = value.checksums[index]
    const chunkSize = value.sizes[index]
    const isFinalChunk = index === value.sizes.length - 1
    if (
      typeof checksum !== 'string' ||
      checksum.length === 0 ||
      !Number.isSafeInteger(chunkSize) ||
      chunkSize <= 0 ||
      chunkSize > maxBlockMapChunkBytes ||
      (!isFinalChunk && chunkSize < minBlockMapChunkBytes)
    ) {
      return false
    }
    describedSize += chunkSize
    if (!Number.isSafeInteger(describedSize)) {
      return false
    }
  }

  if (describedSize !== payloadSize) {
    return false
  }

  const readBuffer = Buffer.allocUnsafe(blockMapReadBufferBytes)
  let position = 0
  for (let index = 0; index < value.checksums.length; index += 1) {
    const digest = blake2b.create({ dkLen: 18 })
    let remaining = value.sizes[index]

    while (remaining > 0) {
      const bytesToRead = Math.min(remaining, readBuffer.length)
      const { bytesRead } = await handle.read(readBuffer, 0, bytesToRead, position)
      if (bytesRead !== bytesToRead) {
        return false
      }
      digest.update(readBuffer.subarray(0, bytesRead))
      remaining -= bytesRead
      position += bytesRead
    }

    if (Buffer.from(digest.digest()).toString('base64') !== value.checksums[index]) {
      return false
    }
  }

  return true
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function readYaml(path, label) {
  let value

  try {
    value = load(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} must be readable valid YAML`, { cause: error })
  }

  return isRecord(value) ? value : {}
}

async function sha512File(path) {
  const hash = createHash('sha512')

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }

  return hash.digest('base64')
}

async function embeddedBlockMapSize(path) {
  const handle = await open(path, 'r')

  try {
    const { size } = await handle.stat()
    requireCondition(size >= 4, 'AppImage must contain an embedded block-map trailer')

    const trailer = Buffer.alloc(4)
    const { bytesRead } = await handle.read(trailer, 0, trailer.length, size - trailer.length)
    requireCondition(bytesRead === trailer.length, 'AppImage block-map trailer must be readable')
    const blockMapSize = trailer.readUInt32BE(0)
    requireCondition(
      blockMapSize <= maxCompressedBlockMapBytes,
      'AppImage compressed block map cannot exceed 16 MiB'
    )
    requireCondition(
      blockMapSize <= size - trailer.length,
      'AppImage block-map size cannot exceed the bytes before its trailer'
    )

    const compressedBlockMap = Buffer.alloc(blockMapSize)
    const blockMapRead = await handle.read(
      compressedBlockMap,
      0,
      compressedBlockMap.length,
      size - trailer.length - compressedBlockMap.length
    )
    requireCondition(
      blockMapRead.bytesRead === compressedBlockMap.length,
      'AppImage embedded block map must be readable'
    )

    let blockMapJson
    try {
      blockMapJson = inflateRawSync(compressedBlockMap, {
        maxOutputLength: maxInflatedBlockMapBytes
      })
    } catch (error) {
      if (isRecord(error) && error.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new Error('AppImage inflated block map cannot exceed 32 MiB', { cause: error })
      }
      throw new Error('AppImage embedded block map must be valid deflate-compressed JSON', {
        cause: error
      })
    }

    let blockMap
    try {
      blockMap = JSON.parse(blockMapJson.toString())
    } catch (error) {
      throw new Error('AppImage embedded block map must be valid deflate-compressed JSON', {
        cause: error
      })
    }
    requireCondition(
      isRecord(blockMap) && blockMap.version === '2' && Array.isArray(blockMap.files),
      'AppImage embedded block map must use the electron-updater v2 files format'
    )
    requireCondition(
      blockMap.files.length === 1 &&
        (await blockMapFileDescribesPayload(
          handle,
          blockMap.files[0],
          size - trailer.length - compressedBlockMap.length
        )),
      'AppImage embedded block map files must describe the AppImage payload'
    )

    return blockMapSize
  } finally {
    await handle.close()
  }
}

function exactFileEntry(files, expectedUrl, label) {
  const matches = files.filter((file) => isRecord(file) && file.url === expectedUrl)
  requireCondition(matches.length === 1, `latest-linux.yml must contain one exact ${label} entry`)
  return matches[0]
}

async function verifyPackageEntry(entry, path, label) {
  const packageStat = await stat(path)
  const digest = await sha512File(path)

  requireCondition(
    entry.size === packageStat.size,
    `${label} size must match the packaged artifact`
  )
  requireCondition(entry.sha512 === digest, `${label} sha512 must match the packaged artifact`)

  return digest
}

function verifyUpdaterConfig(config, expectedPublish, expectedUpdaterCacheDirName, label) {
  requireCondition(
    config.provider === expectedPublish.provider,
    `${label} updater provider must be "github"`
  )
  requireCondition(
    config.owner === expectedPublish.owner,
    `${label} updater owner must match electron-builder.yml`
  )
  requireCondition(
    config.repo === expectedPublish.repo,
    `${label} updater repo must match electron-builder.yml`
  )
  requireCondition(
    config.releaseType === expectedPublish.releaseType,
    `${label} updater releaseType must match electron-builder.yml`
  )
  requireCondition(
    config.updaterCacheDirName === expectedUpdaterCacheDirName,
    `${label} updater cache directory must match electron-builder`
  )
}

async function expectedConfiguration() {
  const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'))
  const builderConfig = await readYaml(builderConfigPath, 'electron-builder.yml')

  requireCondition(
    typeof packageMetadata.version === 'string',
    'package.json version must be present'
  )
  requireCondition(
    isRecord(builderConfig.publish),
    'electron-builder.yml publish configuration must be present'
  )

  return {
    version: packageMetadata.version,
    publish: builderConfig.publish,
    updaterCacheDirName: `${packageMetadata.name.toLowerCase()}-updater`
  }
}

export async function verifyLinuxUpdateMetadata({
  manifestPath,
  appImagePath,
  debPath,
  appImageUpdatePath,
  debUpdatePath
}) {
  const [{ version, publish, updaterCacheDirName }, manifest, appImageUpdate, debUpdate] =
    await Promise.all([
      expectedConfiguration(),
      readYaml(manifestPath, 'latest-linux.yml'),
      readYaml(appImageUpdatePath, 'AppImage app-update.yml'),
      readYaml(debUpdatePath, 'deb app-update.yml')
    ])
  const appImageName = basename(appImagePath)
  const debName = basename(debPath)

  requireCondition(manifest.version === version, 'latest-linux.yml version must match package.json')
  requireCondition(Array.isArray(manifest.files), 'latest-linux.yml files must be an array')
  requireCondition(
    manifest.files.length === 2,
    'latest-linux.yml files must contain exactly the AppImage and deb entries'
  )

  const appImageEntry = exactFileEntry(manifest.files, appImageName, 'AppImage')
  const debEntry = exactFileEntry(manifest.files, debName, 'deb')

  requireCondition(
    Number.isInteger(appImageEntry.blockMapSize) && appImageEntry.blockMapSize > 0,
    'AppImage entry must contain a positive blockMapSize'
  )
  requireCondition(
    appImageEntry.blockMapSize === (await embeddedBlockMapSize(appImagePath)),
    'AppImage blockMapSize must match the AppImage trailer'
  )

  const [appImageDigest] = await Promise.all([
    verifyPackageEntry(appImageEntry, appImagePath, 'AppImage'),
    verifyPackageEntry(debEntry, debPath, 'deb')
  ])

  requireCondition(
    manifest.path === appImageName,
    'latest-linux.yml path must be the exact AppImage filename'
  )
  requireCondition(
    manifest.sha512 === appImageDigest,
    'latest-linux.yml top-level sha512 must match the AppImage'
  )

  verifyUpdaterConfig(appImageUpdate, publish, updaterCacheDirName, 'AppImage')
  verifyUpdaterConfig(debUpdate, publish, updaterCacheDirName, 'deb')
}

async function main() {
  const [manifestPath, appImagePath, debPath, appImageUpdatePath, debUpdatePath] =
    process.argv.slice(2)
  requireCondition(
    [manifestPath, appImagePath, debPath, appImageUpdatePath, debUpdatePath].every(Boolean),
    'Usage: node scripts/verify-linux-update-metadata.mjs <manifest> <AppImage> <deb> <AppImage app-update.yml> <deb app-update.yml>'
  )

  await verifyLinuxUpdateMetadata({
    manifestPath,
    appImagePath,
    debPath,
    appImageUpdatePath,
    debUpdatePath
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
