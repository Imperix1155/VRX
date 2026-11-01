import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { SocialActionService } from '../services/socialActionService'

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
import { registerSocialHandlers } from './social'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  getRelationship: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-person' })),
  act: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-person' }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)
const USER = 'usr_5a3c1e2d-0000-4000-8000-000000000001'

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerSocialHandlers(service as unknown as SocialActionService)
})

describe('Social action IPC boundary', () => {
  it('registers exactly the two channels', () => {
    expect([...handlers.keys()].sort()).toEqual(['get-relationship', 'social-action'])
  })

  it.each(['get-relationship', 'social-action'])(
    'guards %s before parsing or delegating',
    (channel) => {
      trusted.value = false
      expect(() => call(channel, { platform: 'vrchat', userId: USER, action: 'block' })).toThrow(
        'Untrusted IPC sender'
      )
      expect(service.getRelationship).not.toHaveBeenCalled()
      expect(service.act).not.toHaveBeenCalled()
    }
  )

  it('rejects unknown platforms, actions, extra keys, lists and unbounded IDs', () => {
    for (const req of [
      null,
      { platform: 'steam', userId: USER },
      { platform: 'vrchat', userId: '' },
      { platform: 'vrchat', userId: 'x'.repeat(65) },
      { platform: 'vrchat', userId: [USER, USER] },
      { platform: 'vrchat', userId: USER, extra: 1 }
    ]) {
      expect(() => call('get-relationship', req)).toThrow()
    }
    for (const req of [
      { platform: 'vrchat', userId: USER },
      { platform: 'vrchat', userId: USER, action: 'report' },
      { platform: 'vrchat', userId: USER, action: 'mute' },
      { platform: 'vrchat', userId: [USER], action: 'block' },
      { platform: 'vrchat', userIds: [USER], action: 'block' },
      { platform: 'vrchat', userId: USER, action: 'block', all: true }
    ]) {
      expect(() => call('social-action', req)).toThrow()
    }
    expect(service.getRelationship).not.toHaveBeenCalled()
    expect(service.act).not.toHaveBeenCalled()
  })

  it('delegates only the validated values', async () => {
    await call('get-relationship', { platform: 'chilloutvr', userId: USER })
    await call('social-action', { platform: 'vrchat', userId: USER, action: 'unfriend' })
    await call('social-action', { platform: 'chilloutvr', userId: USER, action: 'unblock' })
    expect(service.getRelationship).toHaveBeenCalledWith('chilloutvr', USER)
    expect(service.act).toHaveBeenNthCalledWith(1, 'vrchat', USER, 'unfriend')
    expect(service.act).toHaveBeenNthCalledWith(2, 'chilloutvr', USER, 'unblock')
  })
})
