import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { JoinMode, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_JOIN_MODES = new Set<JoinMode>(['desktop', 'vr'])

export function registerInstanceHandlers(adapters: Map<Platform, IPlatformAdapter>): void {
  ipcMain.handle('join-instance', (event, req: IpcInvoke['join-instance']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.instanceId !== 'string' ||
      !req.instanceId ||
      !VALID_JOIN_MODES.has(req.mode)
    ) {
      throw new Error('Invalid join-instance request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.joinInstance(req.instanceId, req.mode)
  })

  ipcMain.handle('self-invite', (event, req: IpcInvoke['self-invite']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.instanceId !== 'string' ||
      !req.instanceId
    ) {
      throw new Error('Invalid self-invite request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    return adapter.selfInvite(req.instanceId)
  })
}
