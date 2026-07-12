import { ipcMain } from 'electron'
import type { Account } from '@shared/types'
import type { AccountRegistry } from '../services/accountRegistry'
import type { AccountSession } from '../services/accountSession'
import { isTrustedIpcSender } from './security'

export function registerAccountsHandlers(
  accountRegistry: AccountRegistry,
  accountSession: AccountSession
): void {
  ipcMain.handle('get-accounts', (event): Account[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    // VRX-89 decides whether and how a logged-out account picker may project history.
    return accountRegistry
      .listAccounts()
      .filter((account) => !('status' in accountSession.resolve(account.platform)))
  })
}
