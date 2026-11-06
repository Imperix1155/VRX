import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AvatarLibraryService } from '../services/avatarLibraryService'
import type { CurrentAvatarService } from '../services/currentAvatarService'

const { handlers, trusted } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  trusted: { value: true }
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: () => trusted.value }))
import { registerAvatarLibraryHandlers, registerCurrentAvatarHandler } from './avatar-library'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  getLibrary: vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' })),
  getDetails: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-avatar' })),
  switchAvatar: vi.fn(() => Promise.resolve({ ok: true }))
}
const currentService = {
  getCurrent: vi.fn(() => Promise.resolve({ ok: true, platform: 'vrchat', current: null }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)
const AVATAR = 'avtr_5a3c1e2d-0000-4000-8000-000000000001'

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerAvatarLibraryHandlers(service as unknown as AvatarLibraryService)
  registerCurrentAvatarHandler(currentService as unknown as CurrentAvatarService)
})

describe('Avatar library IPC boundary', () => {
  it.each(['get-avatar-library', 'get-avatar-details', 'switch-avatar'])(
    'guards %s before parsing or delegating',
    (channel) => {
      trusted.value = false
      expect(() => call(channel, { platform: 'vrchat', avatarId: AVATAR })).toThrow(
        'Untrusted IPC sender'
      )
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
    }
  )

  it('rejects unknown platforms, extra keys and unbounded avatar IDs', () => {
    for (const req of [null, {}, { platform: 'steam' }, { platform: 'vrchat', extra: 1 }]) {
      expect(() => call('get-avatar-library', req)).toThrow()
    }
    for (const req of [
      { platform: 'vrchat' },
      { platform: 'vrchat', avatarId: '' },
      { platform: 'vrchat', avatarId: 'x'.repeat(65) },
      { platform: 'vrchat', avatarId: 42 },
      { platform: 'vrchat', avatarId: AVATAR, url: 'https://example.com' }
    ]) {
      expect(() => call('switch-avatar', req)).toThrow()
      expect(() => call('get-avatar-details', req)).toThrow()
    }
    expect(service.switchAvatar).not.toHaveBeenCalled()
    expect(service.getDetails).not.toHaveBeenCalled()
  })

  it('delegates only the validated platform and avatar ID', async () => {
    await call('get-avatar-library', { platform: 'chilloutvr' })
    expect(service.getLibrary).toHaveBeenCalledWith('chilloutvr')
    await expect(call('switch-avatar', { platform: 'vrchat', avatarId: AVATAR })).resolves.toEqual({
      ok: true
    })
    expect(service.switchAvatar).toHaveBeenCalledWith('vrchat', AVATAR)
    await call('get-avatar-details', { platform: 'vrchat', avatarId: AVATAR })
    expect(service.getDetails).toHaveBeenCalledWith('vrchat', AVATAR)
  })

  it('guards and validates the worn-avatar read before delegating', async () => {
    trusted.value = false
    expect(() => call('get-current-avatar', { platform: 'vrchat' })).toThrow('Untrusted IPC sender')
    trusted.value = true
    for (const req of [null, {}, { platform: 'steam' }, { platform: 'vrchat', avatarId: AVATAR }]) {
      expect(() => call('get-current-avatar', req)).toThrow()
    }
    expect(currentService.getCurrent).not.toHaveBeenCalled()
    await call('get-current-avatar', { platform: 'chilloutvr' })
    expect(currentService.getCurrent).toHaveBeenCalledWith('chilloutvr')
    expect(service.getLibrary).not.toHaveBeenCalled()
  })
})
