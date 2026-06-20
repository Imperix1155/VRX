import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>()
  const storeOptions: Array<{ name: string; accessPropertiesByDotNotation?: boolean }> = []

  class StoreMock {
    private readonly name: string

    constructor(options: { name: string; accessPropertiesByDotNotation?: boolean }) {
      const { name } = options
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
      this.values[key] = value
    }

    delete(key: string): void {
      delete this.values[key]
    }
  }

  return {
    stores,
    storeOptions,
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
  saveCredential
} from './credentials'

const originalPlatform = process.platform

describe('credential storage', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mocks.stores.clear()
    mocks.storeOptions.length = 0
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
      { name: 'credentials', accessPropertiesByDotNotation: false }
    ])
  })

  it('decrypts a stored credential in the main process', () => {
    saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')

    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('raw-auth-token')
    expect(mocks.decryptString).toHaveBeenCalledWith(Buffer.from('encrypted:raw-auth-token'))
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
    expect(mocks.stores.get('credentials')).toBeUndefined()
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
    expect(mocks.stores.get('credentials')).toBeUndefined()
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

  it('does not persist when encryption throws', () => {
    mocks.encryptString.mockImplementationOnce(() => {
      throw new Error('encryption failed')
    })

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'raw-auth-token')).toThrow(
      'encryption failed'
    )
    expect(mocks.stores.get('credentials')).toBeUndefined()
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
