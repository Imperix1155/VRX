import { app } from 'electron'
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import type { Stats } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

export const LOCAL_CREDENTIAL_PREFIX = '!vrx-local-v1!'

const KEY_LENGTH = 32
const NONCE_LENGTH = 12
const TAG_LENGTH = 16
const MAX_PLAINTEXT_BYTES = 1024 * 1024
const MAX_SLOT_BYTES = 1024
const LOCAL_CREDENTIAL_ERROR = 'Local credential encryption failed'
const STORAGE_DIRECTORY_NAME = 'credential-storage'
const KEY_FILE_NAME = 'key-v1'
const POSIX_FILE_MODE = 0o600
const POSIX_DIRECTORY_MODE = 0o700

function fail(): never {
  throw new Error(LOCAL_CREDENTIAL_ERROR)
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function validateSlot(slot: string): Buffer {
  if (typeof slot !== 'string') return fail()
  const encoded = Buffer.from(slot, 'utf8')
  if (encoded.length === 0 || encoded.length > MAX_SLOT_BYTES) return fail()
  return encoded
}

function credentialDirectory(): string {
  return join(app.getPath('userData'), STORAGE_DIRECTORY_NAME)
}

function requiredLstat(path: string): Stats {
  try {
    return lstatSync(path)
  } catch {
    return fail()
  }
}

function assertPrivateDirectory(path: string): void {
  const details = requiredLstat(path)
  if (!details.isDirectory() || details.isSymbolicLink()) return fail()
  if (!isWindows()) {
    if (
      details.uid !== process.getuid?.() ||
      (Number(details.mode) & 0o777) !== POSIX_DIRECTORY_MODE
    ) {
      return fail()
    }
  }
}

function ensurePrivateDirectory(): string {
  const path = credentialDirectory()
  let created = false
  try {
    mkdirSync(path, { mode: POSIX_DIRECTORY_MODE })
    created = true
    if (!isWindows()) {
      // mkdir honors umask; explicitly pin the created private directory to 0700.
      const descriptor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
      try {
        fchmodSync(descriptor, POSIX_DIRECTORY_MODE)
      } finally {
        closeSync(descriptor)
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') return fail()
  }
  assertPrivateDirectory(path)
  if (created && !isWindows()) syncDirectory(dirname(path))
  return path
}

function assertKeyStats(details: Stats): void {
  if (!details.isFile() || details.nlink !== 1 || details.size !== KEY_LENGTH) return fail()
  if (!isWindows()) {
    if (details.uid !== process.getuid?.() || (Number(details.mode) & 0o777) !== POSIX_FILE_MODE)
      return fail()
  }
}

function readExistingKey(path: string): Buffer {
  const lstat = requiredLstat(path)
  if (lstat.isSymbolicLink()) return fail()
  assertKeyStats(lstat)

  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor)
    assertKeyStats(opened)
    if (opened.dev !== lstat.dev || opened.ino !== lstat.ino) return fail()

    const key = Buffer.alloc(KEY_LENGTH)
    if (readSync(descriptor, key, 0, KEY_LENGTH, 0) !== KEY_LENGTH) return fail()
    return key
  } catch {
    return fail()
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function syncDirectory(path: string): void {
  // Windows applies the normal userData profile ACL. Node cannot reliably open
  // and FlushFileBuffers a directory handle there; the synced key file plus
  // atomic rename is the available durability boundary on that platform.
  if (isWindows()) return
  let descriptor: number | undefined
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0)
    )
    fsyncSync(descriptor)
  } catch {
    return fail()
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function createKey(directory: string, keyPath: string): Buffer {
  const key = randomBytes(KEY_LENGTH)
  const temporaryPath = join(directory, `.${KEY_FILE_NAME}.${randomBytes(16).toString('hex')}.tmp`)
  let descriptor: number | undefined
  let renamed = false
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      POSIX_FILE_MODE
    )
    if (!isWindows()) fchmodSync(descriptor, POSIX_FILE_MODE)
    if (writeSync(descriptor, key, 0, key.length, 0) !== KEY_LENGTH) return fail()
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined

    // The Electron main process already owns the single-instance lock. Rename
    // makes the complete, synced key appear atomically to this process.
    renameSync(temporaryPath, keyPath)
    renamed = true
    syncDirectory(directory)
    return readExistingKey(keyPath)
  } catch {
    return fail()
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (!renamed) {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // A failed cleanup cannot expose a credential because no ciphertext was returned.
      }
    }
  }
}

function getKey(create: boolean): Buffer {
  const directory = credentialDirectory()
  if (!create) {
    assertPrivateDirectory(directory)
    return readExistingKey(join(directory, KEY_FILE_NAME))
  }

  const privateDirectory = ensurePrivateDirectory()
  const keyPath = join(privateDirectory, KEY_FILE_NAME)
  try {
    lstatSync(keyPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return createKey(privateDirectory, keyPath)
    }
    return fail()
  }
  try {
    return readExistingKey(keyPath)
  } catch {
    // A present key is never replaced: corruption and aliases fail closed.
    return fail()
  }
}

function aad(slot: Buffer): Buffer {
  return Buffer.concat([Buffer.from('vrx-local-v1\u0000', 'utf8'), slot])
}

function decodeRecord(record: string): Buffer {
  if (typeof record !== 'string' || !record.startsWith(LOCAL_CREDENTIAL_PREFIX)) return fail()
  const encoded = record.slice(LOCAL_CREDENTIAL_PREFIX.length)
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_PLAINTEXT_BYTES + NONCE_LENGTH + TAG_LENGTH) / 3) * 4
  ) {
    return fail()
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (
    decoded.length < NONCE_LENGTH + TAG_LENGTH ||
    decoded.length > MAX_PLAINTEXT_BYTES + NONCE_LENGTH + TAG_LENGTH ||
    decoded.toString('base64') !== encoded
  ) {
    return fail()
  }
  return decoded
}

export function encryptLocalCredential(slot: string, plaintext: string): string {
  const slotBytes = validateSlot(slot)
  if (typeof plaintext !== 'string') return fail()
  const payload = Buffer.from(plaintext, 'utf8')
  if (payload.length > MAX_PLAINTEXT_BYTES) return fail()

  try {
    const key = getKey(true)
    const nonce = randomBytes(NONCE_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aad(slotBytes))
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${LOCAL_CREDENTIAL_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64')}`
  } catch {
    return fail()
  }
}

export function decryptLocalCredential(slot: string, record: string): string {
  const slotBytes = validateSlot(slot)
  const decoded = decodeRecord(record)

  try {
    const key = getKey(false)
    const nonce = decoded.subarray(0, NONCE_LENGTH)
    const tag = decoded.subarray(NONCE_LENGTH, NONCE_LENGTH + TAG_LENGTH)
    const ciphertext = decoded.subarray(NONCE_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aad(slotBytes))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (plaintext.length > MAX_PLAINTEXT_BYTES) return fail()
    return plaintext.toString('utf8')
  } catch {
    return fail()
  }
}
