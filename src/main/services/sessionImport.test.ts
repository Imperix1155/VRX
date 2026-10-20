import { describe, expect, it, vi } from 'vitest'
import { SESSION_IMPORT_NOT_FOUND, type LoginResult } from '@shared/types'
import type { CVRCredentials } from './adapters/CvrApiClient'
import { createSessionImporter, type SessionImportWiring } from './sessionImport'

function wiring(overrides: Partial<SessionImportWiring> = {}): SessionImportWiring {
  return {
    discoverVrchat: vi.fn(() => Promise.resolve<string | null>('auth=authcookie_x')),
    discoverChilloutvr: vi.fn(() =>
      Promise.resolve<CVRCredentials | null>({ username: 'nova', accessKey: 'key' })
    ),
    vrchat: { importSession: vi.fn(() => Promise.resolve<LoginResult>({ ok: true })) },
    chilloutvr: { importSession: vi.fn(() => Promise.resolve<LoginResult>({ ok: true })) },
    ...overrides
  }
}

const notFound = { ok: false, needs2fa: false, error: SESSION_IMPORT_NOT_FOUND }

describe('createSessionImporter', () => {
  it('hands the VRCX cookie to the VRChat adapter only', async () => {
    const w = wiring()
    await expect(createSessionImporter(w)('vrchat')).resolves.toEqual({ ok: true })
    expect(w.vrchat.importSession).toHaveBeenCalledWith('auth=authcookie_x')
    expect(w.discoverChilloutvr).not.toHaveBeenCalled()
    expect(w.chilloutvr.importSession).not.toHaveBeenCalled()
  })

  it('hands the ChilloutVR access key to the ChilloutVR adapter only', async () => {
    const w = wiring()
    await expect(createSessionImporter(w)('chilloutvr')).resolves.toEqual({ ok: true })
    expect(w.chilloutvr.importSession).toHaveBeenCalledWith({ username: 'nova', accessKey: 'key' })
    expect(w.discoverVrchat).not.toHaveBeenCalled()
    expect(w.vrchat.importSession).not.toHaveBeenCalled()
  })

  it.each(['vrchat', 'chilloutvr'] as const)(
    'reports not found for %s when nothing is on this PC, without touching the adapter',
    async (platform) => {
      const w = wiring({
        discoverVrchat: () => Promise.resolve(null),
        discoverChilloutvr: () => Promise.resolve(null)
      })
      await expect(createSessionImporter(w)(platform)).resolves.toEqual(notFound)
      expect(w.vrchat.importSession).not.toHaveBeenCalled()
      expect(w.chilloutvr.importSession).not.toHaveBeenCalled()
    }
  )

  it('treats an unreadable source like no source', async () => {
    const w = wiring({ discoverVrchat: () => Promise.reject(new Error('EACCES /secret/path')) })
    await expect(createSessionImporter(w)('vrchat')).resolves.toEqual(notFound)
  })

  it('passes the adapter result through, including a 2FA prompt', async () => {
    const w = wiring({
      vrchat: {
        importSession: () =>
          Promise.resolve<LoginResult>({ ok: false, needs2fa: true, method: 'email' })
      }
    })
    await expect(createSessionImporter(w)('vrchat')).resolves.toEqual({
      ok: false,
      needs2fa: true,
      method: 'email'
    })
  })
})
