import { ipcMain } from 'electron'
import type { Account } from '@shared/types'
import type { AccountRegistry } from '../services/accountRegistry'
import { isTrustedIpcSender } from './security'

export function registerAccountsHandlers(accountRegistry: AccountRegistry): void {
  ipcMain.handle('get-accounts', (event): Account[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return accountRegistry.listAccounts()
  })
}
