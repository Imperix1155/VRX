import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>()
  const storeOptions: Array<{ name: string; accessPropertiesByDotNotation?: boolean }> = []
  const setErrors = new Map<string, Error>()
  const delayedSetErrors = new Map<string, { successfulWritesRemaining: number; error: Error }>()
  const deleteErrors = new Map<string, Error>()
  const constructorErrors = new Map<string, Error>()

  class StoreMock {
    private readonly name: string

    constructor(options: { name: string; accessPropertiesByDotNotation?: boolean }) {
      const { name } = options
      const error = constructorErrors.get(name)
      if (error) {
        constructorErrors.delete(name)
        throw error
      }
      this.name = name
      storeOptions.push(options)
      stores.set(name, stores.get(name) ?? {})
    }

    private get values(): Record<string, unknown> {
      const values = stores.get(this.name) ?? {}
      stores.set(this.name, values)
      return values
    }

    get(key: string): unknown {
      return this.values[key]
    }

    set(key: string, value: unknown): void {
      const error = setErrors.get(this.name)
      if (error) {
        setErrors.delete(this.name)
        throw error
      }
      const delayedError = delayedSetErrors.get(this.name)
      if (delayedError) {
        if (delayedError.successfulWritesRemaining === 0) {
          delayedSetErrors.delete(this.name)
          throw delayedError.error
        }
        delayedError.successfulWritesRemaining -= 1
      }
      this.values[key] = value
    }

    delete(key: string): void {
      const error = deleteErrors.get(this.name)
      if (error) {
        deleteErrors.delete(this.name)
        throw error
      }
      delete this.values[key]
    }
  }

  return {
    stores,
    storeOptions,
    setErrors,
    delayedSetErrors,
    deleteErrors,
    constructorErrors,
    StoreMock,
    localEncrypt: vi.fn(
      (slot: string, value: string) =>
        '!vrx-local-v1!' + Buffer.from(JSON.stringify([slot, value])).toString('base64')
    ),
    localDecrypt: vi.fn(
      (_slot: string, value: string) =>
        (
          JSON.parse(
            Buffer.from(value.slice('!vrx-local-v1!'.length), 'base64').toString()
          ) as string[]
        )[1]
    ),
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace('encrypted:', ''))
  }
})

vi.mock('./localCredentialEncryption', () => ({
  LOCAL_CREDENTIAL_PREFIX: '!vrx-local-v1!',
  encryptLocalCredential: mocks.localEncrypt,
  decryptLocalCredential: mocks.localDecrypt
}))

vi.mock('electron-store', () => ({ default: mocks.StoreMock }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    getSelectedStorageBackend: mocks.getSelectedStorageBackend,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString
  }
}))

import {
  CREDENTIAL_KEYS,
  clearCredential,
  CredentialEncryptionUnavailableError,
  loadCredential,
  removeLegacyCredentialOwnerStore,
  saveCredential
} from './credentials'

const originalPlatform = process.platform

describe('credential storage', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mocks.stores.clear()
    mocks.storeOptions.length = 0
    mocks.setErrors.clear()
    mocks.delayedSetErrors.clear()
    mocks.deleteErrors.clear()
    mocks.constructorErrors.clear()
    mocks.isEncryptionAvailable.mockReturnValue(true)
    mocks.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    mocks.getSelectedStorageBackend.mockClear()
    mocks.encryptString.mockClear()
    mocks.decryptString.mockClear()
    mocks.localEncrypt.mockClear()
    mocks.localDecrypt.mockClear()
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('defines focused keys for VRChat and ChilloutVR credentials', () => {
    expect(CREDENTIAL_KEYS).toEqual({
      VRCHAT_PRIMARY: 'vrchat:primary',
      CHILLOUTVR_PRIMARY: 'chilloutvr:primary'
    })
  })

  it('persists only the base64-encoded encrypted blob', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    const persisted = mocks.stores.get('credentials')
    expect(persisted).toEqual({
      'vrchat:primary': Buffer.from('encrypted:raw-auth-token').toString('base64')
    })
    expect(JSON.stringify(persisted)).not.toContain('raw-auth-token')
    expect(mocks.encryptString).toHaveBeenCalledWith('raw-auth-token')
    expect(mocks.storeOptions).toEqual([
      { name: 'credentials', accessPropertiesByDotNotation: false }
    ])
  })

  it('decrypts a stored credential in the main process', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
    expect(mocks.decryptString).toHaveBeenCalledWith(Buffer.from('encrypted:raw-auth-token'))
  })

  it('leaves a non-restorable slot when its replacement ciphertext write throws', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    const oldCiphertext = mocks.stores.get('credentials')?.['vrchat:primary']
    mocks.delayedSetErrors.set('credentials', {
      successfulWritesRemaining: 1,
      error: new Error('credential write failed')
    })

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')).toThrow(
      'credential write failed'
    )

    expect(mocks.stores.get('credentials')?.['vrchat:primary']).not.toBe(oldCiphertext)
    expect(mocks.stores.has('credential-owners')).toBe(false)
    mocks.decryptString.mockClear()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('cannot restore an old credential when both encryption paths and cleanup deletion fail', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    const oldCiphertext = mocks.stores.get('credentials')?.['vrchat:primary']
    mocks.encryptString.mockImplementationOnce(() => {
      throw new Error('encryption failed')
    })

    mocks.localEncrypt.mockImplementationOnce(() => {
      throw new Error('local encryption failed')
    })
    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')).toThrow(
      'local encryption failed'
    )

    mocks.deleteErrors.set('credentials', new Error('credential deletion failed'))
    expect(() => clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).not.toThrow()

    mocks.decryptString.mockClear()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
    expect(mocks.stores.get('credentials')?.['vrchat:primary']).not.toBe(oldCiphertext)
    expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('account-a-token')
  })

  it('never creates the removed credential-owner sidecar (#371)', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')
    clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)

    expect(mocks.stores.has('credential-owners')).toBe(false)
    expect(mocks.storeOptions.map((o) => o.name)).not.toContain('credential-owners')
  })

  it('deletes a legacy credential-owner sidecar file and leaves other stores alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrx-owner-'))
    writeFileSync(join(dir, 'credential-owners.json'), '{}')
    writeFileSync(join(dir, 'credentials.json'), '{}')

    removeLegacyCredentialOwnerStore(dir)

    expect(existsSync(join(dir, 'credential-owners.json'))).toBe(false)
    expect(existsSync(join(dir, 'credentials.json'))).toBe(true)
    // Idempotent when the file is already gone.
    expect(() => removeLegacyCredentialOwnerStore(dir)).not.toThrow()
  })

  it('never throws when the legacy sidecar cannot be removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrx-owner-'))
    // A directory in its place makes the non-recursive delete fail.
    mkdirSync(join(dir, 'credential-owners.json'))

    expect(() => removeLegacyCredentialOwnerStore(dir)).not.toThrow()
    expect(() => removeLegacyCredentialOwnerStore(join(dir, 'missing'))).not.toThrow()
  })

  it('returns undefined when a credential is not stored', () => {
    expect(loadCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('rejects a stored non-string credential as malformed', () => {
    mocks.stores.set('credentials', { 'vrchat:primary': 42 })

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow(
      'Stored credential is malformed'
    )
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it.each(['linux', 'darwin', 'win32'])(
    'uses local persistence when OS encryption is unavailable on %s',
    (platform) => {
      Object.defineProperty(process, 'platform', { value: platform })
      mocks.isEncryptionAvailable.mockReturnValue(false)
      saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')
      expect(mocks.localEncrypt).toHaveBeenCalledWith(
        CREDENTIAL_KEYS.VRCHAT_PRIMARY,
        'raw-auth-token'
      )
      expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('raw-auth-token')
      expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
      expect(mocks.encryptString).not.toHaveBeenCalled()
    }
  )

  it('fails explicitly when decryption is unavailable', () => {
    mocks.stores.set('credentials', {
      'vrchat:primary': Buffer.from('encrypted:raw-auth-token').toString('base64')
    })
    mocks.isEncryptionAvailable.mockReturnValue(false)

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow(
      CredentialEncryptionUnavailableError
    )
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('clears a stored credential even when encryption is unavailable', () => {
    mocks.stores.set('credentials', { 'vrchat:primary': 'encrypted-blob' })
    mocks.isEncryptionAvailable.mockReturnValue(false)

    clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)

    expect(mocks.stores.get('credentials')).toEqual({})
  })

  it('uses local encryption instead of Linux basic_text even when available reports true', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    mocks.getSelectedStorageBackend.mockReturnValue('basic_text')
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(mocks.localEncrypt).toHaveBeenCalledOnce()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
  })

  it('allows supported Linux storage backends', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    mocks.getSelectedStorageBackend.mockReturnValue('kwallet6')

    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    expect(mocks.encryptString).toHaveBeenCalledWith('raw-auth-token')
  })

  it('does not inspect the Linux storage backend on other platforms', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    expect(mocks.getSelectedStorageBackend).not.toHaveBeenCalled()
  })

  it('falls back when the native encrypt call throws after reporting available', () => {
    mocks.encryptString.mockImplementationOnce(() => {
      throw new Error('native failure')
    })
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')
    expect(mocks.localEncrypt).toHaveBeenCalledOnce()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
  })

  it.each(Object.values(CREDENTIAL_KEYS))(
    'upgrades a local session on the next validated save for %s',
    (key) => {
      mocks.isEncryptionAvailable.mockReturnValue(false)
      saveCredential(key, 'synthetic-session')
      const local = mocks.stores.get('credentials')?.[key]
      mocks.isEncryptionAvailable.mockReturnValue(true)
      expect(loadCredential(key)).toBe('synthetic-session')
      expect(mocks.stores.get('credentials')?.[key]).toBe(local)
      saveCredential(key, 'synthetic-session')
      expect(mocks.stores.get('credentials')?.[key]).toBe(
        Buffer.from('encrypted:synthetic-session').toString('base64')
      )
      expect(loadCredential(key)).toBe('synthetic-session')
      clearCredential(key)
      expect(loadCredential(key)).toBeUndefined()
      expect(mocks.stores.has('credential-owners')).toBe(false)
    }
  )

  it('keeps local replacement and logout fenced when physical deletion fails', () => {
    mocks.isEncryptionAvailable.mockReturnValue(false)
    const key = CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY
    saveCredential(key, 'synthetic-account-a-session')
    saveCredential(key, 'synthetic-account-b-session')
    expect(loadCredential(key)).toBe('synthetic-account-b-session')
    mocks.deleteErrors.set('credentials', new Error('delete failed'))
    clearCredential(key)
    expect(loadCredential(key)).toBeUndefined()
    mocks.localDecrypt.mockClear()
    expect(loadCredential(key)).toBeUndefined()
    expect(mocks.localDecrypt).not.toHaveBeenCalled()
  })

  it('does not select local fallback when a ciphertext write fails', () => {
    mocks.delayedSetErrors.set('credentials', {
      successfulWritesRemaining: 1,
      error: new Error('disk full')
    })
    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'synthetic-session')).toThrow(
      'disk full'
    )
    expect(mocks.localEncrypt).not.toHaveBeenCalled()
  })

  it('does not reinterpret an unreadable OS record as a local record', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'synthetic-session')
    mocks.decryptString.mockImplementationOnce(() => {
      throw new Error('locked')
    })
    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow('locked')
    expect(mocks.localEncrypt).not.toHaveBeenCalled()
    expect(mocks.localDecrypt).not.toHaveBeenCalled()
  })

  it.each(['vrchat.primary', 'unsupported'])('rejects unsupported key %s', (key) => {
    expect(() => saveCredential(key as never, 'raw-auth-token')).toThrow(
      'Unsupported credential key'
    )
    expect(() => loadCredential(key as never)).toThrow('Unsupported credential key')
    expect(() => clearCredential(key as never)).toThrow('Unsupported credential key')
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(mocks.decryptString).not.toHaveBeenCalled()
    expect(mocks.stores.get('credentials')).toBeUndefined()
  })

  it('propagates decryption failures', () => {
    mocks.stores.set('credentials', {
      'vrchat:primary': Buffer.from('encrypted:raw-auth-token').toString('base64')
    })
    mocks.decryptString.mockImplementationOnce(() => {
      throw new Error('decryption failed')
    })

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow('decryption failed')
  })

  it('rejects malformed base64 without attempting decryption', () => {
    mocks.stores.set('credentials', { 'vrchat:primary': 'not base64!' })

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow('malformed')
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('rejects load on Linux basic_text without decrypting existing stored blobs', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    mocks.getSelectedStorageBackend.mockReturnValue('basic_text')
    mocks.stores.set('credentials', {
      'vrchat:primary': Buffer.from('encrypted:raw-auth-token').toString('base64')
    })

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow(
      CredentialEncryptionUnavailableError
    )
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })
})
