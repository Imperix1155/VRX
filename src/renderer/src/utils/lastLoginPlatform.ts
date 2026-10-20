import type { Platform } from '@shared/types'

/** localStorage key for the platform of the last successful sign-in. */
export const LAST_LOGIN_PLATFORM_STORAGE_KEY = 'vrx:last-login-platform'

function storage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    return undefined
  }
}

/**
 * The platform the user last signed in to, or VRChat when nothing is stored
 * (first run, cleared storage, or an unknown value). LoginScreen opens on it.
 */
export function readLastLoginPlatform(): Platform {
  try {
    const value = storage()?.getItem(LAST_LOGIN_PLATFORM_STORAGE_KEY)
    return value === 'chilloutvr' ? 'chilloutvr' : 'vrchat'
  } catch {
    return 'vrchat'
  }
}

/** Remember a successful sign-in's platform. Storage failures are ignored. */
export function rememberLoginPlatform(platform: Platform): void {
  try {
    storage()?.setItem(LAST_LOGIN_PLATFORM_STORAGE_KEY, platform)
  } catch {
    // Private or blocked storage: the login screen falls back to VRChat.
  }
}
