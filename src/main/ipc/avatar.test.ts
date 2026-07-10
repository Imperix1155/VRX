import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { AVATAR_MAX_URL_LENGTH } from '../services/avatarCache'

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

const service = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../services/avatarCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/avatarCache')>()),
  avatarCache: service
}))

import { registerAvatarHandlers } from './avatar'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const call = (req: unknown): unknown => handlers.get('get-avatar')!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  service.get.mockReset().mockResolvedValue(null)
  registerAvatarHandlers()
})

describe('get-avatar handler boundary', () => {
  it('rejects an untrusted sender before inspecting the payload', async () => {
    trusted.value = false
    await expect(call(null)).rejects.toThrow('Untrusted IPC sender')
    expect(service.get).not.toHaveBeenCalled()
  })

  it('rejects overlong URLs before delegating to the cache', async () => {
    const url = 'x'.repeat(AVATAR_MAX_URL_LENGTH + 1)
    await expect(call({ url })).rejects.toThrow('Invalid avatar URL')
    expect(service.get).not.toHaveBeenCalled()
  })

  it('delegates a valid string URL', async () => {
    const url = 'https://files.vrchat.cloud/avatar.png'
    service.get.mockResolvedValue('data:image/png;base64,eA==')
    await expect(call({ url })).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,eA=='
    })
    expect(service.get).toHaveBeenCalledWith(url)
  })
})
