import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOCAL_CREDENTIAL_PREFIX,
  encryptLocalCredential,
  decryptLocalCredential
} from './localCredentialEncryption'
import log from '../logger'

const ENCRYPTION_UNAVAILABLE_MESSAGE = 'Credential encryption is unavailable'
const MALFORMED_CREDENTIAL_MESSAGE = 'Stored credential is malformed'
const UNSUPPORTED_CREDENTIAL_KEY_MESSAGE = 'Unsupported credential key'
// Deliberately not valid base64, so it cannot collide with safeStorage output.
// A failed replacement/delete may leave this marker behind; load treats it as
// an empty slot and never tries to decrypt an older credential after restart.
const INVALIDATED_CREDENTIAL = '!vrx-credential-invalidated-v1!'
// Written over the slot by an explicit sign-out (never removed) so the next
// launch can tell "the user signed out" from "never signed in" and skip external
// session import. It is the revocation itself: load treats it as empty, and the
// next save replaces it.
const SIGNED_OUT_CREDENTIAL = '!vrx-credential-signed-out-v1!'

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

function openStore(): Store<Partial<Record<CredentialKey, string>>> {
  return new Store<Partial<Record<CredentialKey, string>>>({
    name: 'credentials',
    accessPropertiesByDotNotation: false
  })
}

/**
 * conf rethrows a JSON SyntaxError from construction, so a damaged
 * credentials.json failed every load and every later save until the file was
 * hand-deleted. Move it aside (renamed, like settings.corrupt-*.json) and start
 * an empty store: an unreadable file yields no credential, so this fails closed.
 * Any other error (permissions, I/O) leaves the file alone and still throws.
 */
function getStore(): Store<Partial<Record<CredentialKey, string>>> {
  if (store) return store
  try {
    store = openStore()
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
    const dir = app.getPath('userData')
    renameSync(join(dir, 'credentials.json'), join(dir, `credentials.corrupt-${Date.now()}.json`))
    store = openStore()
    log.warn('credentials: damaged credentials file set aside; sign-in starts fresh')
  }
  return store
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
  if (encrypted === INVALIDATED_CREDENTIAL || encrypted === SIGNED_OUT_CREDENTIAL) return undefined
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
 * Explicit user sign-out. One write replaces the credential with the signed-out
 * marker, so the slot is never absent: a crash or failed write can never leave
 * it looking like "never signed in" to the next launch's session import. If that
 * write throws, the sign-out fails like clearCredential.
 */
export function signOutCredential(key: CredentialKey): void {
  requireCredentialKey(key)
  getStore().set(key, SIGNED_OUT_CREDENTIAL)
}

/** True when the slot holds the explicit sign-out marker (no session, by choice). */
export function isCredentialSignedOut(key: CredentialKey): boolean {
  requireCredentialKey(key)
  return getStore().get(key) === SIGNED_OUT_CREDENTIAL
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
