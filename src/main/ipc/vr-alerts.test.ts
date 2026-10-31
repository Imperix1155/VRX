import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

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

import { registerVrAlertHandlers } from './vr-alerts'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
let test: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  test = vi.fn(async () => undefined)
  registerVrAlertHandlers({ test })
})

describe('test-vr-alert handler', () => {
  it('rejects an untrusted sender before sending anything', async () => {
    trusted.value = false
    await expect(handlers.get('test-vr-alert')!(event)).rejects.toThrow('Untrusted IPC sender')
    expect(test).not.toHaveBeenCalled()
  })

  it('sends one test alert and ignores any request payload', async () => {
    await expect(handlers.get('test-vr-alert')!(event, { host: '10.0.0.1' })).resolves.toEqual({
      ok: true
    })
    expect(test).toHaveBeenCalledOnce()
    expect(test).toHaveBeenCalledWith()
  })

  it('returns a typed failure without the error', async () => {
    test.mockRejectedValueOnce(new Error('EACCES'))
    await expect(handlers.get('test-vr-alert')!(event)).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
  })
})
