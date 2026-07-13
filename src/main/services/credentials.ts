import { safeStorage } from 'electron'
import Store from 'electron-store'
import { createHash } from 'node:crypto'
import { isPlatformAccountId } from './accountSession'

const ENCRYPTION_UNAVAILABLE_MESSAGE = 'Credential encryption is unavailable'
const MALFORMED_CREDENTIAL_MESSAGE = 'Stored credential is malformed'
const UNSUPPORTED_CREDENTIAL_KEY_MESSAGE = 'Unsupported credential key'

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
  requireEncryption()
  const encrypted = safeStorage.encryptString(plaintext).toString('base64')
  // Fail closed: if ciphertext writing throws, the owner stays cleared rather than becoming stale.
  getOwnerStore().delete(key)
  getStore().set(key, encrypted)
}

export function loadCredential(key: CredentialKey): string | undefined {
  requireCredentialKey(key)
  const encrypted = getStore().get(key)
  if (encrypted === undefined) return undefined
  if (typeof encrypted !== 'string') throw new Error(MALFORMED_CREDENTIAL_MESSAGE)

  requireEncryption()
  return safeStorage.decryptString(decodeCredential(encrypted))
}

export function recordCredentialOwner(key: CredentialKey, platformAccountId: string): void {
  requireCredentialKey(key)
  if (!isPlatformAccountId(platformAccountId)) throw new Error('invalid platformAccountId')

  const encrypted = getStore().get(key)
  if (encrypted === undefined) return
  if (typeof encrypted !== 'string') throw new Error(MALFORMED_CREDENTIAL_MESSAGE)

  getOwnerStore().set(key, {
    platformAccountId,
    credentialDigest: credentialDigest(encrypted)
  })
}

export function getCredentialOwner(key: CredentialKey): { platformAccountId: string } | null {
  requireCredentialKey(key)
  const encrypted = getStore().get(key)
  if (typeof encrypted !== 'string') return null

  const owner: unknown = getOwnerStore().get(key)
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('platformAccountId' in owner) ||
    !('credentialDigest' in owner) ||
    typeof owner.platformAccountId !== 'string' ||
    typeof owner.credentialDigest !== 'string' ||
    !isPlatformAccountId(owner.platformAccountId) ||
    credentialDigest(encrypted) !== owner.credentialDigest
  ) {
    return null
  }

  return { platformAccountId: owner.platformAccountId }
}

export function clearCredential(key: CredentialKey): void {
  requireCredentialKey(key)
  getStore().delete(key)
  getOwnerStore().delete(key)
}
