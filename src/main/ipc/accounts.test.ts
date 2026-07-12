import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AccountRegistry } from '../services/accountRegistry'

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

  beforeEach(() => {
    handlers.clear()
    trusted.value = true
    listAccounts.mockReset()
    registerAccountsHandlers({ listAccounts } as unknown as AccountRegistry)
  })

  it('sender-guards before reading the registry', () => {
    trusted.value = false

    expect(() => handlers.get('get-accounts')!(event)).toThrow('Untrusted IPC sender')
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('returns the registry non-removed Account list', () => {
    listAccounts.mockReturnValue([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: true
      }
    ])

    expect(handlers.get('get-accounts')!(event)).toEqual(listAccounts.mock.results[0]?.value)
    expect(listAccounts).toHaveBeenCalledOnce()
  })
})
