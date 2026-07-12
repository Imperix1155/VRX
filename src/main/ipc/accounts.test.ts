import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AccountRegistry } from '../services/accountRegistry'
import { AccountSession } from '../services/accountSession'

const handlers = new Map<string, (event: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerAccountsHandlers } from './accounts'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

describe('get-accounts handler', () => {
  const listAccounts = vi.fn<AccountRegistry['listAccounts']>()
  let accountSession: AccountSession

  beforeEach(() => {
    handlers.clear()
    trusted.value = true
    listAccounts.mockReset()
    accountSession = new AccountSession()
    registerAccountsHandlers({ listAccounts } as unknown as AccountRegistry, accountSession)
  })

  it('sender-guards before reading the registry', () => {
    trusted.value = false

    expect(() => handlers.get('get-accounts')!(event)).toThrow('Untrusted IPC sender')
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('returns no account metadata without an authenticated session', () => {
    listAccounts.mockReturnValue([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: true
      }
    ])

    expect(handlers.get('get-accounts')!(event)).toEqual([])
    expect(listAccounts).toHaveBeenCalledOnce()
  })

  it('returns non-removed accounts only for authenticated platforms', () => {
    accountSession.setIdentity('vrchat', 'usr_a')
    listAccounts.mockReturnValue([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: true
      },
      {
        platform: 'vrchat',
        platformAccountId: 'usr_old',
        displayName: 'Old Alice',
        isActive: false
      },
      {
        platform: 'chilloutvr',
        platformAccountId: 'cvr_a',
        displayName: 'Casey',
        isActive: true
      }
    ])

    expect(handlers.get('get-accounts')!(event)).toEqual([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: true
      },
      {
        platform: 'vrchat',
        platformAccountId: 'usr_old',
        displayName: 'Old Alice',
        isActive: false
      }
    ])
  })
})
