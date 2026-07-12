import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Friend, Platform } from '@shared/types'
import { stubPlatformAdapter } from '../services/adapters/__testutils__/adapterTestKit'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { LocationAuthority } from '../services/locationAuthority'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => true) }))

import { registerFriendsHandlers } from './friends'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const rosterFriend = {
  platform: 'vrchat',
  platformUserId: 'usr_friend',
  displayName: 'Friend',
  avatarUrl: null,
  presence: { state: 'in-game' },
  instance: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null,
  status: 'online',
  statusDescription: null,
  trustRank: null
} as Friend

let adapter: IPlatformAdapter
let authority: LocationAuthority

beforeEach(() => {
  handlers.clear()
  adapter = stubPlatformAdapter()
  authority = new LocationAuthority()
  registerFriendsHandlers(new Map<Platform, IPlatformAdapter>([['vrchat', adapter]]), authority)
})

describe('get-friends location seeding', () => {
  it('captures before awaiting and seeds every successful response', async () => {
    vi.mocked(adapter.getFriends).mockResolvedValue([rosterFriend])
    const capture = vi.spyOn(authority, 'captureSeedRevision')
    const seed = vi.spyOn(authority, 'seed')

    await expect(handlers.get('get-friends')!(event, { platform: 'vrchat' })).resolves.toEqual([
      rosterFriend
    ])
    expect(capture).toHaveBeenCalledWith('vrchat')
    const captureOrder = capture.mock.invocationCallOrder[0]
    const fetchOrder = vi.mocked(adapter.getFriends).mock.invocationCallOrder[0]
    if (captureOrder === undefined || fetchOrder === undefined) {
      throw new Error('Expected capture and fetch calls')
    }
    expect(captureOrder).toBeLessThan(fetchOrder)
    expect(seed).toHaveBeenCalledWith('vrchat', [rosterFriend], expect.any(Number))
  })

  it('does not seed a failed response', async () => {
    vi.mocked(adapter.getFriends).mockRejectedValue(new Error('network'))
    const seed = vi.spyOn(authority, 'seed')
    await expect(handlers.get('get-friends')!(event, { platform: 'vrchat' })).rejects.toThrow(
      'network'
    )
    expect(seed).not.toHaveBeenCalled()
  })
})
