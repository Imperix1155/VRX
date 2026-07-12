import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Friend, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { stubPlatformAdapter } from '../services/adapters/__testutils__/adapterTestKit'
import { LocationAuthority } from '../services/locationAuthority'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
const openExternal = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  },
  shell: { openExternal }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerInstanceHandlers } from './instance'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const launchUrl = 'vrchat://launch?ref=vrchat.com&id=wrld_example:instance-1'

function friend(overrides: Partial<Friend> = {}): Friend {
  return {
    platform: 'vrchat',
    platformUserId: 'usr_friend',
    displayName: 'Friend',
    avatarUrl: null,
    presence: { state: 'in-game' },
    instance: {
      worldId: 'wrld_example',
      instanceId: 'instance-1',
      worldName: null,
      thumbnailUrl: null,
      type: 'friends',
      openness: 'friends',
      isGroup: false,
      groupName: null,
      region: null,
      userCount: null
    },
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null,
    ...overrides
  } as Friend
}

let adapter: IPlatformAdapter
let authority: LocationAuthority
let now: number
const log =
  vi.fn<(level: 'warn', message: string, meta: { platform: Platform; reason: string }) => void>()

const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  openExternal.mockReset().mockResolvedValue(undefined)
  adapter = stubPlatformAdapter()
  vi.mocked(adapter.buildJoinUrl).mockReturnValue(launchUrl)
  authority = new LocationAuthority()
  now = 10_000
  log.mockReset()
  registerInstanceHandlers(new Map<Platform, IPlatformAdapter>([['vrchat', adapter]]), authority, {
    clock: () => now,
    log
  })
})

function seed(target = friend()): void {
  const revision = authority.captureSeedRevision('vrchat')
  authority.seed('vrchat', [target], revision)
  authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
}

describe('join-instance handler', () => {
  it('guards the sender before validating', async () => {
    trusted.value = false
    await expect(call('join-instance', null)).rejects.toThrow('Untrusted IPC sender')
  })

  it.each([
    null,
    {},
    { platform: 'steam', friendId: 'usr_friend', mode: 'vr' },
    { platform: 'vrchat', friendId: '', mode: 'vr' },
    { platform: 'vrchat', friendId: 'usr_friend', mode: 'roomscale' }
  ])('schema-rejects malformed request %j', async (req) => {
    await expect(call('join-instance', req)).rejects.toThrow('Invalid join-instance request')
  })

  it('returns stale and unknown-friend without launching', async () => {
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'stale' })
    seed()
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_other', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'unknown-friend' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects a non-joinable friend and an invalid adapter URL', async () => {
    seed(friend({ instance: null }))
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'not-joinable' })

    authority.clearPlatform('vrchat')
    seed()
    vi.mocked(adapter.buildJoinUrl).mockReturnValue('https://evil.example')
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'invalid-url' })
  })

  it('builds, validates, launches, and returns a typed success', async () => {
    seed()
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'desktop' })
    ).resolves.toEqual({ ok: true })
    expect(adapter.buildJoinUrl).toHaveBeenCalledWith(friend().instance, 'desktop')
    expect(openExternal).toHaveBeenCalledWith(launchUrl)
  })

  it('enforces a per-platform in-flight lock and three-second cooldown', async () => {
    seed()
    let release!: () => void
    openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const first = call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'cooldown' })
    release()
    await expect(first).resolves.toEqual({ ok: true })
    now += 2_999
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: false, reason: 'cooldown' })
    now += 1
    await expect(
      call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    ).resolves.toEqual({ ok: true })
  })

  it('logs only platform and denial reason', async () => {
    await call('join-instance', { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' })
    expect(log).toHaveBeenCalledWith('warn', 'instance action denied', {
      platform: 'vrchat',
      reason: 'stale'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('instance-1')
  })
})

describe('self-invite handler', () => {
  it('is VRChat-only and resolves the instance through the authority', async () => {
    seed()
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
    expect(adapter.selfInvite).toHaveBeenCalledWith('wrld_example:instance-1')
    expect(() => call('self-invite', { platform: 'chilloutvr', friendId: 'usr_friend' })).toThrow(
      'Invalid self-invite request'
    )
  })
})
