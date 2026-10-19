import { safeStorage } from 'electron'
import Store from 'electron-store'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOCAL_CREDENTIAL_PREFIX,
  encryptLocalCredential,
  decryptLocalCredential
} from './localCredentialEncryption'

const ENCRYPTION_UNAVAILABLE_MESSAGE = 'Credential encryption is unavailable'
const MALFORMED_CREDENTIAL_MESSAGE = 'Stored credential is malformed'
const UNSUPPORTED_CREDENTIAL_KEY_MESSAGE = 'Unsupported credential key'
// Deliberately not valid base64, so it cannot collide with safeStorage output.
// A failed replacement/delete may leave this marker behind; load treats it as
// an empty slot and never tries to decrypt an older credential after restart.
const INVALIDATED_CREDENTIAL = '!vrx-credential-invalidated-v1!'

export const CREDENTIAL_KEYS = {
  VRCHAT_PRIMARY: 'vrchat:primary',
  CHILLOUTVR_PRIMARY: 'chilloutvr:primary'
} as const

export type CredentialKey = (typeof CREDENTIAL_KEYS)[keyof typeof CREDENTIAL_KEYS]
const CREDENTIAL_KEY_VALUES = new Set<string>(Object.values(CREDENTIAL_KEYS))

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super(ENCRYPTION_UNAVAILABLE_MESSAGE)
    this.name = 'CredentialEncryptionUnavailableError'
  }
}

let store: Store<Partial<Record<CredentialKey, string>>> | undefined

/**
 * Store name of the removed credential-owner sidecar (#371). It was written on
 * every save but never read, so it proved nothing on restore and a failed write
 * could fail a login. Older installs may still hold the file; it is deleted.
 */
const LEGACY_CREDENTIAL_OWNER_STORE = 'credential-owners'

function getStore(): Store<Partial<Record<CredentialKey, string>>> {
  return (store ??= new Store<Partial<Record<CredentialKey, string>>>({
    name: 'credentials',
    accessPropertiesByDotNotation: false
  }))
}

function requireEncryption(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new CredentialEncryptionUnavailableError()
  }
}

function requireCredentialKey(key: CredentialKey): void {
  if (!CREDENTIAL_KEY_VALUES.has(key)) {
    throw new Error(UNSUPPORTED_CREDENTIAL_KEY_MESSAGE)
  }
}

function decodeCredential(encrypted: string): Buffer {
  const decoded = Buffer.from(encrypted, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== encrypted) {
    throw new Error(MALFORMED_CREDENTIAL_MESSAGE)
  }
  return decoded
}

export function saveCredential(key: CredentialKey, plaintext: string): void {
  requireCredentialKey(key)
  const credentials = getStore()
  // Revoke the old slot before any keychain or replacement write that can fail.
  // If a later step throws, the non-secret marker remains a durable load fence.
  credentials.set(key, INVALIDATED_CREDENTIAL)
  let encrypted: string
  try {
    requireEncryption()
    encrypted = safeStorage.encryptString(plaintext).toString('base64')
  } catch {
    // Only OS encryption failure selects the approved local fallback. Store
    // and invalidation failures must still fail the login.
    encrypted = encryptLocalCredential(key, plaintext)
  }
  credentials.set(key, encrypted)
}

export function loadCredential(key: CredentialKey): string | undefined {
  requireCredentialKey(key)
  const encrypted = getStore().get(key)
  if (encrypted === undefined) return undefined
  if (typeof encrypted !== 'string') throw new Error(MALFORMED_CREDENTIAL_MESSAGE)
  if (encrypted === INVALIDATED_CREDENTIAL) return undefined
  if (encrypted.startsWith(LOCAL_CREDENTIAL_PREFIX)) return decryptLocalCredential(key, encrypted)

  // Old OS-protected sessions remain OS-protected. Failure to unlock one must
  // never create a new local key or reinterpret its ciphertext.
  requireEncryption()
  return safeStorage.decryptString(decodeCredential(encrypted))
}

export function clearCredential(key: CredentialKey): void {
  requireCredentialKey(key)
  const credentials = getStore()
  // Persist revocation first. If either physical delete throws, this exact
  // marker still prevents the prior credential from being restored.
  credentials.set(key, INVALIDATED_CREDENTIAL)
  try {
    credentials.delete(key)
  } catch {
    /* marker remains intentionally when physical removal is unavailable */
  }
}

/**
 * Best-effort removal of the legacy credential-owner sidecar file (#371). It
 * held platform account ids next to a ciphertext digest and nothing reads it.
 * Never throws: a leftover file is inert and must not block boot.
 */
export function removeLegacyCredentialOwnerStore(userDataDir: string): void {
  try {
    rmSync(join(userDataDir, `${LEGACY_CREDENTIAL_OWNER_STORE}.json`), { force: true })
  } catch {
    /* inert leftover; retried on the next launch */
  }
}
