import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { FriendAlertPicks } from '../services/friendAlertPicks'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

/** Local "alert me about this friend" picks. Nothing here reaches a platform. */
export function registerAlertPicksHandlers(picks: FriendAlertPicks): void {
  ipcMain.handle('get-alert-picks', (event, req: IpcInvoke['get-alert-picks']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) {
      throw new Error('Invalid get-alert-picks request')
    }
    return picks.list(req.platform)
  })

  ipcMain.handle('set-alert-pick', (event, req: IpcInvoke['set-alert-pick']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) {
      throw new Error('Invalid set-alert-pick request')
    }
    return picks.set(req.platform, req.friendIds, req.picked, req.revision)
  })
}
