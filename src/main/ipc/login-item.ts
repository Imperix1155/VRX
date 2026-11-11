import { ipcMain } from 'electron'
import type { LoginItemStatus } from '@shared/ipc'
import type { LoginItem } from '../services/loginItem'
import { isTrustedIpcSender } from './security'

/**
 * Start with your computer: a read of what the operating system has. The
 * choice itself is a setting (`startWithComputer`); main applies it when it
 * is saved. The answer is a typed word and never a path.
 */
export function registerLoginItemHandlers(loginItem: Pick<LoginItem, 'status'>): void {
  ipcMain.handle('get-login-item', (event): LoginItemStatus => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return loginItem.status()
  })
}
