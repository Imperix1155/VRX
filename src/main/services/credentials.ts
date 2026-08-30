import { safeStorage } from 'electron'
import Store from 'electron-store'
import { createHash } from 'node:crypto'
import { isPlatformAccountId } from './accountSession'

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

interface CredentialOwnerRecord {
  platformAccountId: string
  credentialDigest: string
}

let ownerStore: Store<Partial<Record<CredentialKey, CredentialOwnerRecord>>> | undefined

function getStore(): Store<Partial<Record<CredentialKey, string>>> {
  return (store ??= new Store<Partial<Record<CredentialKey, string>>>({
    name: 'credentials',
    accessPropertiesByDotNotation: false
  }))
}

function getOwnerStore(): Store<Partial<Record<CredentialKey, CredentialOwnerRecord>>> {
  return (ownerStore ??= new Store<Partial<Record<CredentialKey, CredentialOwnerRecord>>>({
    name: 'credential-owners',
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

function credentialDigest(encrypted: string): string {
  return createHash('sha256').update(encrypted).digest('hex')
}

export function saveCredential(key: CredentialKey, plaintext: string): void {
  requireCredentialKey(key)
  const credentials = getStore()
  // Revoke the old slot before any keychain or replacement write that can fail.
  // If a later step throws, the non-secret marker remains a durable load fence.
  credentials.set(key, INVALIDATED_CREDENTIAL)
  const owners = getOwnerStore()
  owners.delete(key)
  requireEncryption()
  const encrypted = safeStorage.encryptString(plaintext).toString('base64')
  credentials.set(key, encrypted)
}

export function loadCredential(key: CredentialKey): string | undefined {
  requireCredentialKey(key)
  const encrypted = getStore().get(key)
  if (encrypted === undefined) return undefined
  if (typeof encrypted !== 'string') throw new Error(MALFORMED_CREDENTIAL_MESSAGE)
  if (encrypted === INVALIDATED_CREDENTIAL) return undefined

  requireEncryption()
  return safeStorage.decryptString(decodeCredential(encrypted))
}

export function recordCredentialOwner(key: CredentialKey, platformAccountId: string): void {
  requireCredentialKey(key)
  if (!isPlatformAccountId(platformAccountId)) throw new Error('invalid platformAccountId')

  const encrypted = getStore().get(key)
  if (encrypted === undefined) return
  if (typeof encrypted !== 'string') throw new Error(MALFORMED_CREDENTIAL_MESSAGE)
  if (encrypted === INVALIDATED_CREDENTIAL) return

  getOwnerStore().set(key, {
    platformAccountId,
    credentialDigest: credentialDigest(encrypted)
  })
}

export function clearCredential(key: CredentialKey): void {
  requireCredentialKey(key)
  const credentials = getStore()
  // Persist revocation first. If either physical delete throws, this exact
  // marker still prevents the prior credential from being restored.
  credentials.set(key, INVALIDATED_CREDENTIAL)
  try {
    getOwnerStore().delete(key)
  } catch {
    /* marker is the durable revocation; sidecar cleanup is best-effort */
  }
  try {
    credentials.delete(key)
  } catch {
    /* marker remains intentionally when physical removal is unavailable */
  }
}
