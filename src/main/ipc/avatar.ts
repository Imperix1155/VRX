import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import { AVATAR_MAX_URL_LENGTH, avatarCache } from '../services/avatarCache'
import { isTrustedIpcSender } from './security'

export function registerAvatarHandlers(): void {
  ipcMain.handle('get-avatar', async (event, req: IpcInvoke['get-avatar']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || typeof req.url !== 'string' || req.url.length > AVATAR_MAX_URL_LENGTH) {
      throw new Error('Invalid avatar URL')
    }
    const dataUrl = await avatarCache.get(req.url)
    return dataUrl === null ? null : { ok: true, dataUrl }
  })
}
