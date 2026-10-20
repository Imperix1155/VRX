import { SESSION_IMPORT_NOT_FOUND, type LoginResult, type Platform } from '@shared/types'
import type { CVRCredentials } from './adapters/CvrApiClient'

/**
 * "Use my sign-in from this PC" (owner, 2026-10-20). Runs only when the user
 * presses the button, and that press is the consent: nothing here runs at
 * startup. Discovery is read-only (VRCX's database snapshot for VRChat; the
 * game's auto-login profile or CVRX for ChilloutVR). The adapter then checks
 * the material with the platform and binds its owner before persisting, so a
 * found-but-dead sign-in never replaces anything.
 */
export interface SessionImportWiring {
  discoverVrchat: () => Promise<string | null>
  discoverChilloutvr: () => Promise<CVRCredentials | null>
  vrchat: { importSession(cookie: string): Promise<LoginResult> }
  chilloutvr: { importSession(credentials: CVRCredentials): Promise<LoginResult> }
}

const NOT_FOUND: LoginResult = { ok: false, needs2fa: false, error: SESSION_IMPORT_NOT_FOUND }

async function discover<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read()
  } catch {
    // An unreadable source is the same as no source; its details stay local.
    return null
  }
}

export function createSessionImporter(
  wiring: SessionImportWiring
): (platform: Platform) => Promise<LoginResult> {
  return async (platform) => {
    if (platform === 'vrchat') {
      const cookie = await discover(wiring.discoverVrchat)
      return cookie === null ? NOT_FOUND : wiring.vrchat.importSession(cookie)
    }
    const credentials = await discover(wiring.discoverChilloutvr)
    return credentials === null ? NOT_FOUND : wiring.chilloutvr.importSession(credentials)
  }
}
