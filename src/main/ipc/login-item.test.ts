import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { LoginItemStatus } from '@shared/ipc'

const handlers = new Map<string, (event: unknown, req?: unknown) => unknown>()
const trusted = vi.hoisted(() => ({ value: true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req?: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerLoginItemHandlers } from './login-item'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
let status: ReturnType<typeof vi.fn<() => LoginItemStatus>>

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  status = vi.fn<() => LoginItemStatus>(() => 'on')
  registerLoginItemHandlers({ status })
})

describe('get-login-item handler', () => {
  it('guards the sender before reading anything', () => {
    trusted.value = false
    expect(() => handlers.get('get-login-item')!(event)).toThrow('Untrusted IPC sender')
    expect(status).not.toHaveBeenCalled()
  })

  it.each(['on', 'off', 'unavailable'] as const)('answers the one word %s', (word) => {
    status.mockReturnValue(word)
    expect(handlers.get('get-login-item')!(event)).toBe(word)
  })

  it('takes no input: a request body changes nothing', () => {
    expect(handlers.get('get-login-item')!(event, { openAtLogin: true, path: 'anything' })).toBe(
      'on'
    )
    expect(status).toHaveBeenCalledExactlyOnceWith()
  })
})
