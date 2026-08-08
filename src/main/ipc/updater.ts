import { ipcMain } from 'electron'
import { getUpdaterService } from '../updater'
import { isTrustedIpcSender } from './security'

/**
 * Updater control channels (VRX-113).
 *
 * Thin wiring over `services/updater.ts`. Every handler is sender-guarded;
 * the service owns the state machine, event broadcast, and consent logic.
 */
export function registerUpdaterHandlers(): void {
  ipcMain.handle('updater:get-state', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return getUpdaterService().snapshot()
  })

  ipcMain.handle('updater:check', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    await getUpdaterService().check()
  })

  ipcMain.handle('updater:download', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    await getUpdaterService().download()
  })

  ipcMain.handle('updater:install', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    getUpdaterService().install()
  })
}
