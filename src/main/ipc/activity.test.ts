import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ActivityFeed } from '../services/activityFeed'

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

import { registerActivityHandlers } from './activity'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const entry = {
  id: 1,
  kind: 'online',
  platform: 'vrchat',
  platformUserId: 'usr_a',
  displayName: 'Alice',
  worldName: null,
  at: 1
}
let feed: {
  list: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  clearAll: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  feed = { list: vi.fn(() => [entry]), clear: vi.fn(), clearAll: vi.fn() }
  registerActivityHandlers(feed as unknown as ActivityFeed)
})

describe('activity handlers', () => {
  it('rejects untrusted senders on both channels', () => {
    trusted.value = false
    for (const channel of ['get-activity', 'clear-activity']) {
      expect(() => handlers.get(channel)!(event, { platforms: ['vrchat'], filter: 'all' })).toThrow(
        'Untrusted IPC sender'
      )
    }
    expect(feed.list).not.toHaveBeenCalled()
    expect(feed.clear).not.toHaveBeenCalled()
    expect(feed.clearAll).not.toHaveBeenCalled()
  })

  it('returns the list and ignores any request payload', () => {
    expect(handlers.get('get-activity')!(event, { platform: 'vrchat' })).toEqual([entry])
    expect(feed.list).toHaveBeenCalledWith()
  })

  it('clears only the platforms and the kind the page shows', () => {
    expect(
      handlers.get('clear-activity')!(event, { platforms: ['chilloutvr'], filter: 'world' })
    ).toBeUndefined()
    expect(feed.clear).toHaveBeenCalledWith(['chilloutvr'], 'world')
    handlers.get('clear-activity')!(event, { platforms: ['vrchat', 'chilloutvr'], filter: 'all' })
    expect(feed.clear).toHaveBeenLastCalledWith(['vrchat', 'chilloutvr'], 'all')
    expect(feed.clearAll).not.toHaveBeenCalled()
  })

  it.each([
    ['no request', undefined],
    ['no platforms', { platforms: [], filter: 'all' }],
    ['an unknown platform', { platforms: ['steam'], filter: 'all' }],
    ['too many platforms', { platforms: ['vrchat', 'chilloutvr', 'vrchat'], filter: 'all' }],
    ['platforms that are not a list', { platforms: 'vrchat', filter: 'all' }],
    ['an unknown kind', { platforms: ['vrchat'], filter: 'friends' }],
    ['no kind', { platforms: ['vrchat'] }],
    ['a request that is not a plain object', Object.create({ platforms: ['vrchat'] }) as unknown]
  ])('refuses %s and clears nothing', (_label, request) => {
    expect(() => handlers.get('clear-activity')!(event, request)).toThrow(
      'Invalid clear-activity request'
    )
    expect(feed.clear).not.toHaveBeenCalled()
    expect(feed.clearAll).not.toHaveBeenCalled()
  })
})
