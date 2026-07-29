import { ipcMain } from 'electron'
import type { AppStatus } from '@shared/types'
import type { AppStatusService } from '../services/appStatus'
import { isTrustedIpcSender } from './security'

export function registerAppStatusHandlers(appStatus: AppStatusService): void {
  ipcMain.handle('get-app-status', (event): AppStatus => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return appStatus.snapshot()
  })
}
