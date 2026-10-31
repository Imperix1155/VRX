import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { CommunityService } from '../services/communityService'

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
import { registerCommunityHandlers } from './community'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  getProfile: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-person' })),
  getProfileWorlds: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-person' })),
  getProfileGroups: vi.fn(() => Promise.resolve({ ok: false, reason: 'unknown-person' })),
  search: vi.fn(() => Promise.resolve({ ok: false, reason: 'invalid-query' })),
  getWorldList: vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' })),
  getPlayersOnline: vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' })),
  getMyGroups: vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)
const USER = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const CHANNELS = [
  'get-profile',
  'get-profile-worlds',
  'get-profile-groups',
  'search-community',
  'get-world-list',
  'get-players-online',
  'get-my-groups'
]

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerCommunityHandlers(service as unknown as CommunityService)
})

describe('Community IPC boundary', () => {
  it('registers exactly the community channels', () => {
    expect([...handlers.keys()].sort()).toEqual([...CHANNELS].sort())
  })

  it.each(CHANNELS)('guards %s before parsing or delegating', (channel) => {
    trusted.value = false
    expect(() => call(channel, { platform: 'vrchat', userId: USER })).toThrow(
      'Untrusted IPC sender'
    )
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })

  it('rejects unknown platforms, extra keys and unbounded values', () => {
    for (const req of [null, {}, { platform: 'steam' }, { platform: 'vrchat', extra: 1 }]) {
      expect(() => call('get-players-online', req)).toThrow()
      expect(() => call('get-my-groups', req)).toThrow()
    }
    for (const req of [
      { platform: 'vrchat' },
      { platform: 'vrchat', userId: '' },
      { platform: 'vrchat', userId: 'x'.repeat(65) },
      { platform: 'vrchat', userId: 42 },
      { platform: 'vrchat', userId: USER, url: 'https://example.com' }
    ]) {
      expect(() => call('get-profile', req)).toThrow()
      expect(() => call('get-profile-worlds', req)).toThrow()
      expect(() => call('get-profile-groups', req)).toThrow()
    }
    expect(() => call('search-community', { platform: 'vrchat', query: 'x'.repeat(257) })).toThrow()
    expect(() => call('search-community', { platform: 'vrchat', query: 5 })).toThrow()
    expect(() => call('get-world-list', { platform: 'vrchat', list: 'popular' })).toThrow()
    expect(() =>
      call('get-world-list', { platform: 'vrchat', list: 'new', refresh: 'yes' })
    ).toThrow()
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })

  it('delegates only the validated values', async () => {
    await call('get-profile', { platform: 'vrchat', userId: USER })
    await call('get-profile-worlds', { platform: 'chilloutvr', userId: USER })
    await call('get-profile-groups', { platform: 'vrchat', userId: USER })
    await call('search-community', { platform: 'vrchat', query: '  cats ' })
    await call('get-world-list', { platform: 'chilloutvr', list: 'updated' })
    await call('get-world-list', { platform: 'vrchat', list: 'new', refresh: true })
    await call('get-players-online', { platform: 'vrchat' })
    await call('get-my-groups', { platform: 'chilloutvr', refresh: true })
    expect(service.getProfile).toHaveBeenCalledWith('vrchat', USER)
    expect(service.getProfileWorlds).toHaveBeenCalledWith('chilloutvr', USER)
    expect(service.getProfileGroups).toHaveBeenCalledWith('vrchat', USER)
    expect(service.search).toHaveBeenCalledWith('vrchat', '  cats ')
    expect(service.getWorldList).toHaveBeenNthCalledWith(1, 'chilloutvr', 'updated', false)
    expect(service.getWorldList).toHaveBeenNthCalledWith(2, 'vrchat', 'new', true)
    expect(service.getPlayersOnline).toHaveBeenCalledWith('vrchat')
    expect(service.getMyGroups).toHaveBeenCalledWith('chilloutvr', true)
  })
})
