import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPath: vi.fn() }))

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))

import {
  decryptLocalCredential,
  encryptLocalCredential,
  LOCAL_CREDENTIAL_PREFIX
} from './localCredentialEncryption'

let userData: string

function keyPath(): string {
  return join(userData, 'credential-storage', 'key-v1')
}

describe('local credential encryption', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'vrx-local-credential-'))
    mocks.getPath.mockReturnValue(userData)
  })

  afterEach(() => {
    rmSync(userData, { force: true, recursive: true })
  })

  it('round-trips through a durable, private key and uses a fresh nonce per write', async () => {
    const first = encryptLocalCredential('vrchat:primary', 'session-token')
    const second = encryptLocalCredential('vrchat:primary', 'session-token')

    expect(first).toMatch(new RegExp(`^${LOCAL_CREDENTIAL_PREFIX}`))
    expect(second).not.toBe(first)
    expect(decryptLocalCredential('vrchat:primary', first)).toBe('session-token')
    expect(lstatSync(keyPath()).size).toBe(32)
    if (process.platform !== 'win32') {
      expect(lstatSync(join(userData, 'credential-storage')).mode & 0o777).toBe(0o700)
      expect(lstatSync(keyPath()).mode & 0o777).toBe(0o600)
    }

    vi.resetModules()
    const freshModule = await import('./localCredentialEncryption')
    expect(freshModule.decryptLocalCredential('vrchat:primary', first)).toBe('session-token')
  })

  it('binds the record to its slot and version and rejects tampering', () => {
    const record = encryptLocalCredential('vrchat:primary', 'session-token')
    const payload = Buffer.from(record.slice(LOCAL_CREDENTIAL_PREFIX.length), 'base64')
    payload.writeUInt8(payload.readUInt8(payload.length - 1) ^ 1, payload.length - 1)
    const tampered = `${LOCAL_CREDENTIAL_PREFIX}${payload.toString('base64')}`

    expect(() => decryptLocalCredential('chilloutvr:primary', record)).toThrow(
      'Local credential encryption failed'
    )
    expect(() => decryptLocalCredential('vrchat:primary', tampered)).toThrow(
      'Local credential encryption failed'
    )
    expect(() => decryptLocalCredential('vrchat:primary', record.replace('v1', 'v2'))).toThrow(
      'Local credential encryption failed'
    )
  })

  it('never creates a key while decrypting a missing, malformed, or oversized record', () => {
    expect(() =>
      decryptLocalCredential('vrchat:primary', `${LOCAL_CREDENTIAL_PREFIX}AAAA`)
    ).toThrow('Local credential encryption failed')
    expect(() =>
      decryptLocalCredential('vrchat:primary', `${LOCAL_CREDENTIAL_PREFIX}not base64!`)
    ).toThrow('Local credential encryption failed')
    expect(() =>
      decryptLocalCredential('vrchat:primary', `${LOCAL_CREDENTIAL_PREFIX}${'A'.repeat(1_400_000)}`)
    ).toThrow('Local credential encryption failed')
    expect(() => lstatSync(keyPath())).toThrow()
  })

  it('never recreates a missing key while decrypting a well-formed record', () => {
    const record = encryptLocalCredential('vrchat:primary', 'session-token')
    rmSync(join(userData, 'credential-storage'), { force: true, recursive: true })

    expect(() => decryptLocalCredential('vrchat:primary', record)).toThrow(
      'Local credential encryption failed'
    )
    expect(() => lstatSync(keyPath())).toThrow()
  })

  it('rejects a truncated key without replacing it', () => {
    mkdirSync(join(userData, 'credential-storage'), { mode: 0o700 })
    writeFileSync(keyPath(), Buffer.alloc(31), { mode: 0o600 })

    expect(() => encryptLocalCredential('vrchat:primary', 'session-token')).toThrow(
      'Local credential encryption failed'
    )
    expect(lstatSync(keyPath()).size).toBe(31)
  })

  it.runIf(process.platform !== 'win32')(
    'rejects public, symlinked, and hard-linked key paths',
    () => {
      mkdirSync(join(userData, 'credential-storage'), { mode: 0o700 })
      writeFileSync(keyPath(), Buffer.alloc(32), { mode: 0o600 })
      chmodSync(keyPath(), 0o644)
      expect(() => encryptLocalCredential('vrchat:primary', 'session-token')).toThrow(
        'Local credential encryption failed'
      )

      rmSync(keyPath())
      const outside = join(userData, 'outside-key')
      writeFileSync(outside, Buffer.alloc(32), { mode: 0o600 })
      symlinkSync(outside, keyPath())
      expect(() => encryptLocalCredential('vrchat:primary', 'session-token')).toThrow(
        'Local credential encryption failed'
      )

      rmSync(keyPath())
      linkSync(outside, keyPath())
      expect(() => encryptLocalCredential('vrchat:primary', 'session-token')).toThrow(
        'Local credential encryption failed'
      )
    }
  )

  it('rejects plaintext above one MiB before creating a key', () => {
    expect(() => encryptLocalCredential('vrchat:primary', 'x'.repeat(1024 * 1024 + 1))).toThrow(
      'Local credential encryption failed'
    )
    expect(() => lstatSync(keyPath())).toThrow()
  })
})
