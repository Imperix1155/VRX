/**
 * ipc/settings handler boundary tests (VRX-184).
 *
 * Same harness as auth.test.ts: handlers captured via a mocked ipcMain.handle,
 * driven directly. Pins: sender-guard rejection on both channels, the patch
 * shape validation (object only — no strings/arrays/null), delegation to the
 * settings service, and the newer-version refusal propagating as a throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { DEFAULT_SETTINGS } from '@shared/settings'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({
  isTrustedIpcSender: vi.fn(() => trusted.value)
}))

const service = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn()
}))
vi.mock('../services/settings', () => service)

import { registerSettingsHandlers } from './settings'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const call = (channel: string, req?: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  service.loadSettings.mockReset().mockReturnValue({ ...DEFAULT_SETTINGS })
  service.saveSettings.mockReset().mockImplementation((patch: object) => ({
    ...DEFAULT_SETTINGS,
    ...patch
  }))
  registerSettingsHandlers()
})

describe('get-settings', () => {
  it('rejects an untrusted sender', () => {
    trusted.value = false
    expect(() => call('get-settings')).toThrow('Untrusted IPC sender')
    expect(service.loadSettings).not.toHaveBeenCalled()
  })

  it('delegates to loadSettings', () => {
    expect(call('get-settings')).toEqual(DEFAULT_SETTINGS)
    expect(service.loadSettings).toHaveBeenCalledOnce()
  })
})

describe('save-settings', () => {
  it('rejects an untrusted sender before touching the payload', () => {
    trusted.value = false
    expect(() => call('save-settings', { patch: { theme: 'dark' } })).toThrow(
      'Untrusted IPC sender'
    )
    expect(service.saveSettings).not.toHaveBeenCalled()
  })

  it.each([
    ['a string patch', { patch: 'dark' }],
    ['an array patch', { patch: ['dark'] }],
    ['a null patch', { patch: null }],
    ['a missing patch', {}],
    ['a non-object req', 'nope']
  ])('rejects %s without calling the service', (_name, req) => {
    expect(() => call('save-settings', req)).toThrow('patch must be an object')
    expect(service.saveSettings).not.toHaveBeenCalled()
  })

  it('delegates a valid patch and returns the normalized settings', () => {
    const res = call('save-settings', { patch: { theme: 'dark' } })
    expect(service.saveSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(res).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it("propagates the service's newer-version refusal", () => {
    service.saveSettings.mockImplementation(() => {
      throw new Error('settings: refusing to overwrite settings written by a newer version')
    })
    expect(() => call('save-settings', { patch: { theme: 'dark' } })).toThrow('newer version')
  })
})
