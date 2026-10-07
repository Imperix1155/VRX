import { afterEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/settings'

const handlers = new Map<string, (event: unknown, req?: unknown) => unknown>()
const storage = vi.hoisted((): { data: Record<string, unknown>; failWrite: boolean } => ({
  data: {},
  failWrite: true
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, req?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))
vi.mock('electron-store', () => ({
  default: class {
    get store(): Record<string, unknown> {
      return storage.data
    }
    set store(value: Record<string, unknown>) {
      if (storage.failWrite) throw new Error('disk full')
      storage.data = structuredClone(value)
    }
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: () => true }))
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

import { registerSettingsHandlers } from './settings'
import { flushPendingSettingsSave } from '../services/settings'

afterEach(() => {
  storage.failWrite = false
  flushPendingSettingsSave()
  vi.useRealTimers()
})

it('returns preserved settings as unsaved after normalization fails and clears metadata after a durable retry', async () => {
  vi.useFakeTimers()
  storage.data = { ...DEFAULT_SETTINGS, theme: 'light', allowJoinInstances: false }
  const original = structuredClone(storage.data)
  registerSettingsHandlers()
  const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
  const getSettings = (): IpcInvoke['get-settings']['res'] =>
    handlers.get('get-settings')!(event) as IpcInvoke['get-settings']['res']

  expect(getSettings()).toMatchObject({
    theme: 'light',
    allowJoinInstances: false,
    unsaved: true
  })
  expect(storage.data).toEqual(original)
  expect(vi.getTimerCount()).toBe(0)

  storage.failWrite = false
  const retry = handlers.get('save-settings')!(event, { patch: { density: 'compact' } })
  await vi.advanceTimersByTimeAsync(250)
  await expect(retry).resolves.toMatchObject({
    theme: 'light',
    allowJoinInstances: false,
    density: 'compact'
  })
  expect(getSettings()).toEqual(storage.data)
  expect(getSettings()).not.toHaveProperty('unsaved')
})
