import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { AuthStatus, LoginResult, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import log from '../logger'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const MAX_USERNAME_LENGTH = 256
const MAX_PASSWORD_LENGTH = 1_024
const MAX_TWO_FACTOR_CODE_LENGTH = 64

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

export interface AuthHandlerOptions {
  onLoginSuccess?: (platform: Platform) => void
  onAuthStatus?: (status: AuthStatus) => void
  /**
   * "Use my sign-in from this PC". The click is the consent: main reads VRCX
   * (VRChat) or ChilloutVR/CVRX (ChilloutVR) read-only and hands the material
   * to the adapter, which validates its owner before anything is persisted.
   */
  importSession?: (platform: Platform) => Promise<LoginResult>
  /** After an explicit sign-out succeeded; a throwing callback is logged, not surfaced. */
  onLogout?: (platform: Platform) => void
}

export function registerAuthHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  options: AuthHandlerOptions = {}
): void {
  ipcMain.handle('get-auth-status', (event, req: IpcInvoke['get-auth-status']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid platform')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.getAuthStatus().then((status) => {
      try {
        options.onAuthStatus?.(status)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`onAuthStatus callback failed for ${req.platform}: ${message}`)
      }
      return status
    })
  })

  ipcMain.handle('login', (event, req: IpcInvoke['login']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      !isBoundedString(req.credentials?.username, MAX_USERNAME_LENGTH) ||
      !isBoundedString(req.credentials?.password, MAX_PASSWORD_LENGTH) ||
      (req.credentials.twoFactorCode !== undefined &&
        !isBoundedString(req.credentials.twoFactorCode, MAX_TWO_FACTOR_CODE_LENGTH))
    ) {
      throw new Error('Invalid login request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.login(req.credentials).then((result) => {
      // The side-effect callback must never turn a successful login into a
      // renderer-visible failure.
      if (result.ok) {
        try {
          options.onLoginSuccess?.(req.platform)
        } catch {
          log.warn(`onLoginSuccess callback failed for ${req.platform}`)
        }
      }
      return result
    })
  })

  ipcMain.handle('verify-2fa', (event, req: IpcInvoke['verify-2fa']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      !isBoundedString(req.code, MAX_TWO_FACTOR_CODE_LENGTH)
    ) {
      throw new Error('Invalid verify-2fa request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.verify2fa(req.code).then((result) => {
      if (result.ok) {
        try {
          options.onLoginSuccess?.(req.platform)
        } catch {
          log.warn(`onLoginSuccess callback failed for ${req.platform}`)
        }
      }
      return result
    })
  })

  ipcMain.handle('import-session', (event, req: IpcInvoke['import-session']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform))
      throw new Error('Invalid import-session request')
    const importSession = options.importSession
    if (!importSession) throw new Error('Session import unavailable')
    return importSession(req.platform).then((result) => {
      if (result.ok) {
        try {
          options.onLoginSuccess?.(req.platform)
        } catch {
          log.warn(`onLoginSuccess callback failed for ${req.platform}`)
        }
      }
      return result
    })
  })

  ipcMain.handle('logout', (event, req: IpcInvoke['logout']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid logout request')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    adapter.clearSession()
    try {
      options.onLogout?.(req.platform)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`onLogout callback failed for ${req.platform}: ${message}`)
    }
  })
}
