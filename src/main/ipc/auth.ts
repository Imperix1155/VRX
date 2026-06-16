import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

export function registerAuthHandlers(adapters: Map<Platform, IPlatformAdapter>): void {
  ipcMain.handle('get-auth-status', (event, req: IpcInvoke['get-auth-status']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid platform')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.getAuthStatus()
  })

  ipcMain.handle('login', (event, req: IpcInvoke['login']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.credentials?.username !== 'string' ||
      typeof req.credentials?.password !== 'string'
    ) {
      throw new Error('Invalid login request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.login(req.credentials)
  })
}
