import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Friend, Platform } from '@shared/types'
import { stubPlatformAdapter } from '../services/adapters/__testutils__/adapterTestKit'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { AppStatusService } from '../services/appStatus'
import { LocationAuthority } from '../services/locationAuthority'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))
const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

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
let appStatus: AppStatusService

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  adapter = stubPlatformAdapter()
  authority = new LocationAuthority()
  appStatus = new AppStatusService(() => 12_345)
  registerFriendsHandlers(
    new Map<Platform, IPlatformAdapter>([['vrchat', adapter]]),
    authority,
    appStatus
  )
})

describe('get-friends location seeding', () => {
  it('rejects an untrusted sender before adapter delegation', async () => {
    trusted.value = false

    await expect(handlers.get('get-friends')!(event, { platform: 'vrchat' })).rejects.toThrow(
      'Untrusted IPC sender'
    )
    expect(adapter.getFriends).not.toHaveBeenCalled()
  })

  it.each([null, {}, { platform: 'steam' }, { platform: 1 }, { platform: null }])(
    'rejects malformed request %j before adapter delegation',
    async (req) => {
      await expect(handlers.get('get-friends')!(event, req)).rejects.toThrow('Invalid platform')
      expect(adapter.getFriends).not.toHaveBeenCalled()
    }
  )

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

  it('stamps the platform reconcile time only after a successful friends response', async () => {
    vi.mocked(adapter.getFriends).mockResolvedValue([rosterFriend])

    expect(appStatus.snapshot().lastReconcileAt.vrchat).toBeNull()
    await handlers.get('get-friends')!(event, { platform: 'vrchat' })

    expect(appStatus.snapshot().lastReconcileAt).toEqual({
      vrchat: 12_345,
      chilloutvr: null
    })
  })

  it('seeds a joinable location when optional world metadata is still null', async () => {
    const locationFriend = {
      ...rosterFriend,
      instance: {
        worldId: 'wrld_cold_start',
        instanceId: 'instance-1~private(usr_owner)',
        worldName: null,
        thumbnailUrl: null,
        type: 'invite' as const,
        openness: 'invite' as const,
        isGroup: false,
        groupName: null,
        region: null,
        userCount: null
      }
    } as Friend
    vi.mocked(adapter.getFriends).mockResolvedValue([locationFriend])
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })

    await handlers.get('get-friends')!(event, { platform: 'vrchat' })

    expect(authority.resolve('vrchat', locationFriend.platformUserId)).toEqual({
      ok: true,
      friend: locationFriend
    })
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
