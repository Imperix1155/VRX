/**
 * A damaged credentials.json must not block every later sign-in. conf throws
 * the JSON SyntaxError from its constructor, so this runs the real conf store
 * against a temp folder instead of the in-memory mock in credentials.test.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron-store', async () => {
  const { default: Conf } = await import('conf')
  return {
    default: class extends Conf {
      constructor(options: { name: string; accessPropertiesByDotNotation?: boolean }) {
        super({
          ...options,
          configName: options.name,
          cwd: userData.dir,
          projectName: 'vrx-test'
        })
      }
    }
  }
})
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('electron', () => ({
  app: { getPath: () => userData.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace('encrypted:', '')
  }
}))

const DAMAGED = '{"vrchat:primary": "abc'

describe('damaged credentials file', () => {
  beforeEach(() => {
    vi.resetModules()
    userData.dir = mkdtempSync(join(tmpdir(), 'vrx-credentials-'))
  })

  afterEach(() => {
    rmSync(userData.dir, { recursive: true, force: true })
    userData.dir = ''
  })

  it('sets the damaged file aside so a new sign-in can be saved', async () => {
    writeFileSync(join(userData.dir, 'credentials.json'), DAMAGED)
    const { CREDENTIAL_KEYS, loadCredential, saveCredential } = await import('./credentials')

    expect(() => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, 'new-token')).not.toThrow()
    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe('new-token')

    const kept = readdirSync(userData.dir).find((name) =>
      /^credentials\.corrupt-\d+\.json$/.test(name)
    )
    expect(kept).toBeDefined()
    expect(readFileSync(join(userData.dir, kept!), 'utf8')).toBe(DAMAGED)
    expect(readFileSync(join(userData.dir, 'credentials.json'), 'utf8')).not.toContain('new-token')
  })

  it('fails closed: a damaged file restores no credential', async () => {
    writeFileSync(join(userData.dir, 'credentials.json'), DAMAGED)
    const { CREDENTIAL_KEYS, isCredentialSignedOut, loadCredential } = await import('./credentials')

    expect(loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBeUndefined()
    expect(loadCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)).toBeUndefined()
    expect(isCredentialSignedOut(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toBe(false)
  })

  it('leaves the file alone when it cannot be read for another reason', async () => {
    // A directory in the file's place makes the read fail with EISDIR.
    mkdirSync(join(userData.dir, 'credentials.json'))
    const { CREDENTIAL_KEYS, loadCredential } = await import('./credentials')

    expect(() => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)).toThrow()
    expect(readdirSync(userData.dir)).toEqual(['credentials.json'])
  })
})
