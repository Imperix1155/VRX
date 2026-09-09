import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Friend, Platform } from '@shared/types'
import {
  instantAdmission,
  stubPlatformAdapter
} from '../services/adapters/__testutils__/adapterTestKit'
import { VrcAdapter } from '../services/adapters/VrcAdapter'
import { CvrAdapter } from '../services/adapters/CvrAdapter'
import { parseLocation } from '../services/adapters/vrchat/parseLocation'
import type { FriendRoster } from '../services/adapters/IPlatformAdapter'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { AppStatusService } from '../services/appStatus'
import { LocationAuthority } from '../services/locationAuthority'
import {
  RateLimitError,
  CVRRateLimitError,
  RequestQueueFullError
} from '../services/adapters/errors'

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

afterEach(() => vi.restoreAllMocks())

describe('get-friends location seeding', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'keeps live location newer than a shared %s roster begun before IPC',
    async (platform) => {
      let release!: (roster: FriendRoster) => void
      const held = new Promise<FriendRoster>((resolve) => {
        release = resolve
      })
      const wiring = { captureRosterRevision: () => authority.captureSeedRevision(platform) }
      const realAdapter =
        platform === 'vrchat'
          ? new VrcAdapter(
              { load: () => undefined, save: vi.fn(), delete: vi.fn() },
              instantAdmission(),
              wiring
            )
          : new CvrAdapter(
              { load: () => undefined, save: vi.fn(), delete: vi.fn() },
              instantAdmission(),
              wiring
            )
      // Exercise the real adapter's shared roster lifetime while holding its
      // physical read. No platform request or credential fixture is needed.
      const read = vi
        .spyOn(realAdapter as unknown as { readFriends(): Promise<FriendRoster> }, 'readFriends')
        .mockReturnValue(held)
      registerFriendsHandlers(new Map([[platform, realAdapter]]), authority, appStatus)
      authority.consume({ type: 'connection', platform, health: 'live' })
      const warm = realAdapter.getFriends()
      const oldFriend = {
        ...rosterFriend,
        platform,
        instance: parseLocation('wrld_old:123')
      } as Friend
      const liveFriend = { ...oldFriend, instance: parseLocation('wrld_new:456') }
      authority.consume({ type: 'friend-presence', platform, friend: liveFriend })
      const joined = handlers.get('get-friends')!(event, { platform })
      release({ friends: [oldFriend], completeness: 'complete' })
      await warm
      await joined
      expect(read).toHaveBeenCalledOnce()
      expect(authority.resolve(platform, oldFriend.platformUserId)).toMatchObject({
        ok: true,
        friend: { instance: { worldId: 'wrld_new', instanceId: '456' } }
      })
    }
  )

  it.each(['complete', 'partial'] as const)(
    'uses each physical read fence across a %s reconnect follow-up',
    async (completeness) => {
      let releaseFirst!: (roster: FriendRoster) => void
      let releaseLast!: (roster: FriendRoster) => void
      const first = new Promise<FriendRoster>((resolve) => {
        releaseFirst = resolve
      })
      const last = new Promise<FriendRoster>((resolve) => {
        releaseLast = resolve
      })
      const realAdapter = new VrcAdapter(
        { load: () => undefined, save: vi.fn(), delete: vi.fn() },
        instantAdmission(),
        {
          captureRosterRevision: () => authority.captureSeedRevision('vrchat')
        }
      )
      const read = vi
        .spyOn(realAdapter as unknown as { readFriends(): Promise<FriendRoster> }, 'readFriends')
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(last)
      registerFriendsHandlers(new Map([['vrchat', realAdapter]]), authority, appStatus)
      const oldFriend = { ...rosterFriend, instance: parseLocation('wrld_old:123') }
      const omission = { ...oldFriend, platformUserId: 'usr_omitted' }
      const absent = { ...oldFriend, platformUserId: 'usr_absent' }
      authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
      authority.seed('vrchat', [absent], authority.captureSeedRevision('vrchat'))
      const request = handlers.get('get-friends')!(event, { platform: 'vrchat' })
      authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
      authority.consume({
        type: 'friend-presence',
        platform: 'vrchat',
        friend: {
          ...oldFriend,
          instance: parseLocation('wrld_new:456')
        }
      })
      ;(
        realAdapter as unknown as { rosterRefresh: { invalidate(): void } }
      ).rosterRefresh.invalidate()
      releaseFirst({ friends: [oldFriend, omission], completeness: 'complete' })
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      const joined = handlers.get('get-friends')!(event, { platform: 'vrchat' })
      const fresh = {
        ...oldFriend,
        platformUserId: 'usr_fresh',
        instance: parseLocation('wrld_fresh:789')
      }
      releaseLast({ friends: [fresh], completeness })
      const [result] = await Promise.all([request, joined])
      expect(authority.resolve('vrchat', fresh.platformUserId)).toMatchObject({ ok: true })
      if (completeness === 'partial') {
        expect(authority.resolve('vrchat', oldFriend.platformUserId)).toMatchObject({
          ok: true,
          friend: { instance: { worldId: 'wrld_new' } }
        })
        expect(authority.resolve('vrchat', omission.platformUserId)).toEqual({
          ok: false,
          reason: 'stale'
        })
        expect(authority.resolve('vrchat', absent.platformUserId)).toEqual({
          ok: false,
          reason: 'stale'
        })
        expect(result).toEqual({ friends: [fresh, oldFriend, omission], completeness: 'partial' })
      } else {
        expect(authority.resolve('vrchat', oldFriend.platformUserId)).toEqual({
          ok: false,
          reason: 'unknown-friend'
        })
        expect(result).toEqual([fresh])
      }
    }
  )

  it.each([new RateLimitError(60_000), new CVRRateLimitError(60_000), new RequestQueueFullError()])(
    'sanitizes admission failures and preserves existing authority',
    async (error) => {
      vi.mocked(adapter.getFriends).mockRejectedValue(error)
      const seed = vi.spyOn(authority, 'seed')
      await expect(handlers.get('get-friends')!(event, { platform: 'vrchat' })).rejects.toThrow(
        /^rate_limited$/
      )
      expect(seed).not.toHaveBeenCalled()
      expect(appStatus.snapshot().lastReconcileAt.vrchat).toBeNull()
    }
  )
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
    vi.mocked(adapter.getFriends).mockResolvedValue({
      friends: [rosterFriend],
      completeness: 'complete'
    })
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
    expect(seed).toHaveBeenCalledWith('vrchat', [rosterFriend], expect.any(Number), 'complete')
  })

  it('stamps the platform reconcile time only after a successful friends response', async () => {
    vi.mocked(adapter.getFriends).mockResolvedValue({
      friends: [rosterFriend],
      completeness: 'complete'
    })

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
        groupId: null,
        groupImageUrl: null,
        region: null,
        userCount: null
      }
    } as Friend
    vi.mocked(adapter.getFriends).mockResolvedValue({
      friends: [locationFriend],
      completeness: 'complete'
    })
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

  it('preserves friends omitted from a partial adapter roster', async () => {
    const omittedFriend = { ...rosterFriend, platformUserId: 'usr_omitted' }
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const initialRevision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [rosterFriend, omittedFriend], initialRevision)
    vi.mocked(adapter.getFriends).mockResolvedValue({
      friends: [rosterFriend],
      completeness: 'partial'
    })

    await expect(handlers.get('get-friends')!(event, { platform: 'vrchat' })).resolves.toEqual({
      friends: [rosterFriend],
      completeness: 'partial'
    })
    expect(authority.resolve('vrchat', omittedFriend.platformUserId)).toMatchObject({
      ok: true,
      friend: { platformUserId: omittedFriend.platformUserId }
    })
  })
})
