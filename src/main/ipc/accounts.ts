import { ipcMain } from 'electron'
import type { Account } from '@shared/types'
import { isTrustedIpcSender } from './security'

// VRX-24 owns the multi-account model. This handler returns an empty list until
// that issue lands and wires in the real AccountStore.
export function registerAccountsHandlers(): void {
  ipcMain.handle('get-accounts', (event): Account[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return []
  })
}
