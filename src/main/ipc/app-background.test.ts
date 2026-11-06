import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AppBackgroundStore } from '../services/appBackground'

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

import { registerAppBackgroundHandlers } from './app-background'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
let store: {
  load: ReturnType<typeof vi.fn>
  importFrom: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}
let pickFile: ReturnType<typeof vi.fn<(event: IpcMainInvokeEvent) => Promise<string | null>>>

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  store = {
    load: vi.fn().mockResolvedValue(null),
    importFrom: vi.fn().mockResolvedValue({ ok: true, dataUrl: 'data:image/jpeg;base64,AA' }),
    clear: vi.fn().mockResolvedValue(undefined)
  }
  pickFile = vi
    .fn<(event: IpcMainInvokeEvent) => Promise<string | null>>()
    .mockResolvedValue('/pictures/sunset.jpg')
  registerAppBackgroundHandlers({
    store: store as unknown as AppBackgroundStore,
    pickFile
  })
})

describe('app background handlers', () => {
  it('rejects untrusted senders on every channel', async () => {
    trusted.value = false
    for (const channel of ['get-app-background', 'choose-app-background', 'clear-app-background']) {
      await expect(async () => handlers.get(channel)!(event)).rejects.toThrow(
        'Untrusted IPC sender'
      )
    }
    expect(pickFile).not.toHaveBeenCalled()
    expect(store.clear).not.toHaveBeenCalled()
  })

  it('returns the kept picture or null', async () => {
    await expect(handlers.get('get-app-background')!(event)).resolves.toBeNull()
    store.load.mockResolvedValue('data:image/png;base64,AA')
    await expect(handlers.get('get-app-background')!(event)).resolves.toEqual({
      dataUrl: 'data:image/png;base64,AA'
    })
  })

  it('imports only the file the dialog returned, ignoring any renderer input', async () => {
    const result = await handlers.get('choose-app-background')!(event, { path: '/etc/passwd' })
    expect(result).toEqual({ ok: true, dataUrl: 'data:image/jpeg;base64,AA' })
    expect(store.importFrom).toHaveBeenCalledWith('/pictures/sunset.jpg')
  })

  it('reports a cancelled dialog without touching the store', async () => {
    pickFile.mockResolvedValue(null)
    await expect(handlers.get('choose-app-background')!(event)).resolves.toEqual({
      ok: false,
      reason: 'cancelled'
    })
    expect(store.importFrom).not.toHaveBeenCalled()
  })

  it('joins a second press while the dialog is open, then allows a new one', async () => {
    let finish: (path: string | null) => void = () => undefined
    pickFile.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (finish = resolve))
    )
    const first = handlers.get('choose-app-background')!(event)
    const second = handlers.get('choose-app-background')!(event)
    expect(second).toBe(first)
    finish(null)
    await first
    await handlers.get('choose-app-background')!(event)
    expect(pickFile).toHaveBeenCalledTimes(2)
  })

  it('turns a dialog failure into a typed result', async () => {
    pickFile.mockRejectedValue(new Error('dialog failed'))
    await expect(handlers.get('choose-app-background')!(event)).resolves.toEqual({
      ok: false,
      reason: 'unreadable'
    })
  })

  it('clears the picture', async () => {
    await expect(handlers.get('clear-app-background')!(event)).resolves.toBeUndefined()
    expect(store.clear).toHaveBeenCalledTimes(1)
  })
})
