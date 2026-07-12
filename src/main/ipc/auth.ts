import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { AuthStatus, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import log from 'electron-log'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

export interface AuthHandlerOptions {
  onLoginSuccess?: (platform: Platform) => void
  onAuthStatus?: (status: AuthStatus) => void
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
      } catch {
        log.warn(`onAuthStatus callback failed for ${req.platform}`)
      }
      return status
    })
  })

  ipcMain.handle('login', (event, req: IpcInvoke['login']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.credentials?.username !== 'string' ||
      typeof req.credentials?.password !== 'string' ||
      (req.credentials.twoFactorCode !== undefined &&
        typeof req.credentials.twoFactorCode !== 'string')
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
    if (!req || !VALID_PLATFORMS.has(req.platform) || typeof req.code !== 'string') {
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

  ipcMain.handle('logout', (event, req: IpcInvoke['logout']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid logout request')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.clearSession()
  })
}
