/**
 * ipc/updater handler boundary tests (VRX-113).
 *
 * Pins: sender-guard rejection on every channel, delegation to the updater
 * service, and async/sync handler shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const handlers = new Map<string, (event: unknown, req?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req?: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({
  isTrustedIpcSender: vi.fn(() => trusted.value)
}))

const service = vi.hoisted(() => ({
  snapshot: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))
vi.mock('../updater', () => ({
  getUpdaterService: () => service
}))

import { registerUpdaterHandlers } from './updater'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const call = (channel: string, req?: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  service.snapshot.mockReset().mockReturnValue({ state: 'idle' })
  service.check.mockReset().mockResolvedValue(undefined)
  service.download.mockReset().mockResolvedValue(undefined)
  service.install.mockReset()
  registerUpdaterHandlers()
})

describe('updater:get-state', () => {
  it('rejects an untrusted sender', () => {
    trusted.value = false
    expect(() => call('updater:get-state')).toThrow('Untrusted IPC sender')
    expect(service.snapshot).not.toHaveBeenCalled()
  })

  it('delegates to the service snapshot', () => {
    expect(call('updater:get-state')).toEqual({ state: 'idle' })
    expect(service.snapshot).toHaveBeenCalledOnce()
  })
})

describe('updater:check', () => {
  it('rejects an untrusted sender before touching the service', async () => {
    trusted.value = false
    await expect(call('updater:check')).rejects.toThrow('Untrusted IPC sender')
    expect(service.check).not.toHaveBeenCalled()
  })

  it('delegates to service.check', async () => {
    await call('updater:check')
    expect(service.check).toHaveBeenCalledOnce()
  })
})

describe('updater:download', () => {
  it('rejects an untrusted sender before touching the service', async () => {
    trusted.value = false
    await expect(call('updater:download')).rejects.toThrow('Untrusted IPC sender')
    expect(service.download).not.toHaveBeenCalled()
  })

  it('delegates to service.download', async () => {
    await call('updater:download')
    expect(service.download).toHaveBeenCalledOnce()
  })
})

describe('updater:install', () => {
  it('rejects an untrusted sender before touching the service', () => {
    trusted.value = false
    expect(() => call('updater:install')).toThrow('Untrusted IPC sender')
    expect(service.install).not.toHaveBeenCalled()
  })

  it('delegates to service.install', () => {
    call('updater:install')
    expect(service.install).toHaveBeenCalledOnce()
  })
})
