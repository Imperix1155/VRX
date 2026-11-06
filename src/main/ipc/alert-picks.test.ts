import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { FriendAlertPicks } from '../services/friendAlertPicks'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerAlertPicksHandlers } from './alert-picks'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

describe('alert picks handlers', () => {
  const picks = {
    list: vi.fn(() => ({
      friendIds: ['usr_a'],
      revision: { platformAccountId: 'usr_me', epoch: 1 }
    })),
    set: vi.fn(() => ({ ok: true }))
  }

  beforeEach(() => {
    handlers.clear()
    trusted.value = true
    picks.list.mockClear()
    picks.set.mockClear()
    registerAlertPicksHandlers(picks as unknown as FriendAlertPicks)
  })

  it('rejects an untrusted sender before reading or writing', () => {
    trusted.value = false
    expect(() => handlers.get('get-alert-picks')!(event, { platform: 'vrchat' })).toThrow(
      'Untrusted IPC sender'
    )
    expect(() =>
      handlers.get('set-alert-pick')!(event, { platform: 'vrchat', friendIds: ['usr_a'] })
    ).toThrow('Untrusted IPC sender')
    expect(picks.list).not.toHaveBeenCalled()
    expect(picks.set).not.toHaveBeenCalled()
  })

  it('rejects an unknown platform', () => {
    expect(() => handlers.get('get-alert-picks')!(event, { platform: 'steam' })).toThrow()
    expect(() => handlers.get('set-alert-pick')!(event, null)).toThrow()
  })

  it('passes a valid request through to the picks service', () => {
    expect(handlers.get('get-alert-picks')!(event, { platform: 'chilloutvr' })).toEqual({
      friendIds: ['usr_a'],
      revision: { platformAccountId: 'usr_me', epoch: 1 }
    })
    const revision = { platformAccountId: 'usr_me', epoch: 1 }
    handlers.get('set-alert-pick')!(event, {
      platform: 'vrchat',
      friendIds: ['usr_a'],
      picked: true,
      revision
    })
    expect(picks.set).toHaveBeenCalledWith('vrchat', ['usr_a'], true, revision)
  })
})
