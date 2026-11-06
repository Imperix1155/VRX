import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { OwnProfileService } from '../services/ownProfileService'

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
import { registerOwnProfileHandlers } from './own-profile'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  getOwnProfile: vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' })),
  saveOwnProfile: vi.fn(() => Promise.resolve({ ok: false, reason: 'cooldown' }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerOwnProfileHandlers(service as unknown as OwnProfileService)
})

describe('Own profile IPC boundary', () => {
  it.each(['get-own-profile', 'save-own-profile'])(
    'guards %s before parsing or delegating',
    (channel) => {
      trusted.value = false
      expect(() => call(channel, { platform: 'vrchat', changes: { bio: 'x' } })).toThrow(
        'Untrusted IPC sender'
      )
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
    }
  )

  it('reads with a validated platform only', async () => {
    await call('get-own-profile', { platform: 'chilloutvr' })
    expect(service.getOwnProfile).toHaveBeenCalledWith('chilloutvr')
    for (const req of [null, {}, { platform: 'steam' }, { platform: 'vrchat', userId: 'x' }]) {
      expect(() => call('get-own-profile', req)).toThrow()
    }
    expect(service.getOwnProfile).toHaveBeenCalledTimes(1)
  })

  it('passes known fields through and refuses anything else as invalid', async () => {
    await call('save-own-profile', {
      platform: 'vrchat',
      changes: { bio: 'Hi', pronouns: 'they/them', status: 'ask-me', statusText: 'Around' }
    })
    expect(service.saveOwnProfile).toHaveBeenCalledWith('vrchat', {
      bio: 'Hi',
      pronouns: 'they/them',
      status: 'ask-me',
      statusText: 'Around'
    })
    for (const req of [
      null,
      { platform: 'vrchat' },
      { platform: 'steam', changes: {} },
      { platform: 'vrchat', changes: { displayName: 'x' } },
      { platform: 'vrchat', changes: { status: 'offline' } },
      { platform: 'vrchat', changes: { bio: 'x'.repeat(1025) } },
      { platform: 'vrchat', changes: { bio: 42 } },
      { platform: 'vrchat', changes: {}, accountId: 'usr_x' }
    ]) {
      expect(call('save-own-profile', req)).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(service.saveOwnProfile).toHaveBeenCalledTimes(1)
  })
})
