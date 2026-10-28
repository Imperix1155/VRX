import { ipcMain } from 'electron'
import type { ActivityEntry } from '@shared/activity'
import type { ActivityFeed } from '../services/activityFeed'
import { isTrustedIpcSender } from './security'

/** No renderer input on either channel: main owns the list. */
export function registerActivityHandlers(activity: ActivityFeed): void {
  ipcMain.handle('get-activity', (event): ActivityEntry[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return activity.list()
  })

  ipcMain.handle('clear-activity', (event): void => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    activity.clearAll()
  })
}
