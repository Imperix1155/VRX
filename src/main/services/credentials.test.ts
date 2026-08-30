import { createHash } from 'node:crypto'
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
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace('encrypted:', ''))
  }
})

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
  recordCredentialOwner,
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
      { name: 'credentials', accessPropertiesByDotNotation: false },
      { name: 'credential-owners', accessPropertiesByDotNotation: false }
    ])
  })

  it('invalidates the credential before owner-store initialization can fail', async () => {
    vi.resetModules()
    mocks.stores.set('credentials', {
      'vrchat:primary': Buffer.from('encrypted:account-a-token').toString('base64')
    })
    mocks.constructorErrors.set('credential-owners', new Error('owner store unavailable'))
    const isolated = await import('./credentials')

    expect(() =>
      isolated.saveCredential(isolated.CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')
    ).toThrow('owner store unavailable')
    mocks.decryptString.mockClear()
    expect(isolated.loadCredential(isolated.CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('decrypts a stored credential in the main process', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
    expect(mocks.decryptString).toHaveBeenCalledWith(Buffer.from('encrypted:raw-auth-token'))
  })

  it('records and returns the owner of the exact stored ciphertext', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account-1')

    expect(mocks.stores.get('credential-owners')).toEqual({
      'vrchat:primary': {
        platformAccountId: 'usr_account-1',
        // sha256 of the stored (base64) ciphertext — computed, not hardcoded (no secret literal)
        credentialDigest: createHash('sha256')
          .update(Buffer.from('encrypted:raw-auth-token').toString('base64'))
          .digest('hex')
      }
    })
  })

  it('records B with the digest of B after a completed A-to-B replacement in the same slot', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account_a')
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account_b')

    expect(mocks.stores.get('credential-owners')).toEqual({
      'vrchat:primary': {
        platformAccountId: 'usr_account_b',
        credentialDigest: createHash('sha256')
          .update(Buffer.from('encrypted:account-b-token').toString('base64'))
          .digest('hex')
      }
    })
  })

  it('returns null when a save completes but owner recording is interrupted', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account_a')

    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')

    expect(mocks.stores.get('credential-owners')).toEqual({})
  })

  it('saveCredential clears a pre-existing owner sidecar entry', () => {
    saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, 'account-a-session')
    recordCredentialOwner(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, 'account-a')

    saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, 'account-b-session')

    expect(mocks.stores.get('credential-owners')).toEqual({})
  })

  it('leaves a non-restorable slot when its replacement ciphertext write throws', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account_a')
    const oldCiphertext = mocks.stores.get('credentials')?.['vrchat:primary']
    mocks.delayedSetErrors.set('credentials', {
      successfulWritesRemaining: 1,
      error: new Error('credential write failed')
    })

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')).toThrow(
      'credential write failed'
    )

    expect(mocks.stores.get('credentials')?.['vrchat:primary']).not.toBe(oldCiphertext)
    expect(mocks.stores.get('credential-owners')).toEqual({})
    mocks.decryptString.mockClear()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })

  it('cannot restore an old credential when replacement encryption and cleanup deletion fail', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-a-token')
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account_a')
    const oldCiphertext = mocks.stores.get('credentials')?.['vrchat:primary']
    mocks.encryptString.mockImplementationOnce(() => {
      throw new Error('encryption failed')
    })

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'account-b-token')).toThrow(
      'encryption failed'
    )

    mocks.deleteErrors.set('credentials', new Error('credential deletion failed'))
    expect(() => clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).not.toThrow()

    mocks.decryptString.mockClear()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.decryptString).not.toHaveBeenCalled()
    expect(mocks.stores.get('credentials')?.['vrchat:primary']).not.toBe(oldCiphertext)
    expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('account-a-token')
  })

  it('clears the credential owner sidecar with the stored credential', () => {
    saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, 'cvr-session')
    recordCredentialOwner(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, 'account-2')

    clearCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)

    expect(mocks.stores.get('credentials')).toEqual({})
    expect(mocks.stores.get('credential-owners')).toEqual({})
  })

  it.each(['', 'account.with.dot', 'account id', 'x'.repeat(129)])(
    'rejects unsafe credential owner account id %j',
    (platformAccountId) => {
      saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

      expect(() =>
        recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, platformAccountId)
      ).toThrow('invalid platformAccountId')
      expect(mocks.stores.get('credential-owners')).toEqual({})
    }
  )

  it('does not create an owner sidecar when no ciphertext is stored', () => {
    recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'usr_account-1')

    expect(mocks.stores.get('credential-owners')).toBeUndefined()
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

  it('fails without persisting plaintext when encryption is unavailable', () => {
    mocks.isEncryptionAvailable.mockReturnValue(false)

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')).toThrow(
      CredentialEncryptionUnavailableError
    )
    expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('raw-auth-token')
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(mocks.encryptString).not.toHaveBeenCalled()
  })

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

  it('rejects the Linux basic_text backend even when encryption reports available', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    mocks.getSelectedStorageBackend.mockReturnValue('basic_text')

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')).toThrow(
      CredentialEncryptionUnavailableError
    )
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('raw-auth-token')
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
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

  it('leaves a non-restorable slot when encryption throws', () => {
    mocks.encryptString.mockImplementationOnce(() => {
      throw new Error('encryption failed')
    })

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')).toThrow(
      'encryption failed'
    )
    expect(JSON.stringify(mocks.stores.get('credentials'))).not.toContain('raw-auth-token')
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
  })

  it.each(['vrchat.primary', 'unsupported'])('rejects unsupported key %s', (key) => {
    expect(() => saveCredential(key as never, 'raw-auth-token')).toThrow(
      'Unsupported credential key'
    )
    expect(() => loadCredential(key as never)).toThrow('Unsupported credential key')
    expect(() => clearCredential(key as never)).toThrow('Unsupported credential key')
    expect(() => recordCredentialOwner(key as never, 'usr_account-1')).toThrow(
      'Unsupported credential key'
    )
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
