import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Friend, Platform } from '@shared/types'
import type { IpcInvoke } from '@shared/ipc'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { stubPlatformAdapter } from '../services/adapters/__testutils__/adapterTestKit'
import { LocationAuthority } from '../services/locationAuthority'
import { JoinCoordinator } from '../services/joinCoordinator'
import { GameHandoff, type GameHandoffSettings } from '../services/gameHandoff'
import { hotInstanceKey } from '@shared/hotInstanceKey'

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
      groupId: null,
      groupImageUrl: null,
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
let allowJoinInstances: boolean
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
  allowJoinInstances = true
  log.mockReset()
  registerInstanceHandlers(new Map<Platform, IPlatformAdapter>([['vrchat', adapter]]), authority, {
    clock: () => now,
    log,
    isJoinAllowed: () => allowJoinInstances
  })
})

function seed(target = friend()): void {
  authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
  const revision = authority.captureSeedRevision('vrchat')
  authority.seed('vrchat', [target], revision)
}

function joinReq(
  target: Friend,
  overrides: Partial<IpcInvoke['join-instance']['req']> = {}
): IpcInvoke['join-instance']['req'] {
  if (!target.instance && overrides.expectedTarget === undefined) {
    throw new Error('joinReq: pass an explicit expectedTarget for an instance-less friend')
  }
  return {
    platform: target.platform,
    friendId: target.platformUserId,
    mode: 'vr',
    expectedTarget: {
      worldId: target.instance?.worldId ?? '',
      instanceId: target.instance?.instanceId ?? ''
    },
    ...overrides
  }
}

describe('join-instance handler', () => {
  it('shares the injected Explore launch lock and exact destination cooldown', async () => {
    const coordinator = new JoinCoordinator(() => now)
    registerInstanceHandlers(new Map([['vrchat', adapter]]), authority, {
      clock: () => now,
      isJoinAllowed: () => true,
      joinCoordinator: coordinator
    })
    const target = friend()
    seed(target)
    const key = hotInstanceKey('vrchat', target.instance!.instanceId, target.instance!.worldId)!
    const explore = coordinator.acquire('vrchat', key)!
    await expect(call('join-instance', joinReq(target))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    explore.complete()
    explore.release()
    await expect(call('join-instance', joinReq(target))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    expect(openExternal).not.toHaveBeenCalled()
    now += 3_000
    await expect(call('join-instance', joinReq(target))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(coordinator.acquire('vrchat', key)).toBeNull()
  })

  it('guards the sender before validating', async () => {
    trusted.value = false
    await expect(call('join-instance', null)).rejects.toThrow('Untrusted IPC sender')
  })

  it.each([
    null,
    {},
    {
      platform: 'steam',
      friendId: 'usr_friend',
      mode: 'vr',
      expectedTarget: { worldId: 'w', instanceId: 'i' }
    },
    {
      platform: 'vrchat',
      friendId: '',
      mode: 'vr',
      expectedTarget: { worldId: 'w', instanceId: 'i' }
    },
    {
      platform: 'vrchat',
      friendId: 'usr_friend',
      mode: 'roomscale',
      expectedTarget: { worldId: 'w', instanceId: 'i' }
    },
    { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr' },
    { platform: 'vrchat', friendId: 'usr_friend', mode: 'vr', expectedTarget: null },
    {
      platform: 'vrchat',
      friendId: 'usr_friend',
      mode: 'vr',
      expectedTarget: { worldId: '', instanceId: 'i' }
    },
    {
      platform: 'vrchat',
      friendId: 'usr_friend',
      mode: 'vr',
      expectedTarget: { worldId: 'w', instanceId: '' }
    }
  ])('schema-rejects malformed request %j', async (req) => {
    await expect(call('join-instance', req)).rejects.toThrow('Invalid join-instance request')
  })

  it('blocks a valid join before resolving authority or building a launch URL when disabled', async () => {
    allowJoinInstances = false
    const resolve = vi.spyOn(authority, 'resolve')

    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'joining-disabled'
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(adapter.buildJoinUrl).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    { field: 'worldId', expectedTarget: { worldId: 'w'.repeat(2_049), instanceId: 'i' } },
    { field: 'instanceId', expectedTarget: { worldId: 'w', instanceId: 'i'.repeat(2_049) } }
  ])('schema-rejects $field longer than 2,048 characters', async ({ expectedTarget }) => {
    await expect(
      call('join-instance', {
        platform: 'vrchat',
        friendId: 'usr_friend',
        mode: 'vr',
        expectedTarget
      })
    ).rejects.toThrow('Invalid join-instance request')
  })

  it('schema-rejects a friendId longer than 128 characters', async () => {
    await expect(
      call('join-instance', {
        platform: 'vrchat',
        friendId: 'u'.repeat(129),
        mode: 'vr',
        expectedTarget: { worldId: 'w', instanceId: 'i' }
      })
    ).rejects.toThrow('Invalid join-instance request')
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'u'.repeat(129) })
    ).rejects.toThrow('Invalid self-invite request')
  })

  it('accepts expectedTarget fields of exactly 2,048 characters', async () => {
    await expect(
      call('join-instance', {
        platform: 'vrchat',
        friendId: 'usr_friend',
        mode: 'vr',
        expectedTarget: { worldId: 'w'.repeat(2_048), instanceId: 'i'.repeat(2_048) }
      })
    ).resolves.toEqual({ ok: false, reason: 'stale' })
  })

  it('returns stale and unknown-friend without launching', async () => {
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'stale'
    })
    seed()
    await expect(
      call('join-instance', joinReq(friend(), { friendId: 'usr_other' }))
    ).resolves.toEqual({ ok: false, reason: 'unknown-friend' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects a non-joinable friend and an invalid adapter URL', async () => {
    seed(friend({ instance: null }))
    await expect(
      call(
        'join-instance',
        joinReq(friend({ instance: null }), {
          expectedTarget: { worldId: 'wrld_example', instanceId: 'instance-1' }
        })
      )
    ).resolves.toEqual({ ok: false, reason: 'not-joinable' })

    authority.clearPlatform('vrchat')
    seed()
    vi.mocked(adapter.buildJoinUrl).mockReturnValue('https://evil.example')
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'invalid-url'
    })
  })

  it('builds, validates, launches, and returns a typed success', async () => {
    seed()
    await expect(call('join-instance', joinReq(friend(), { mode: 'desktop' }))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(adapter.buildJoinUrl).toHaveBeenCalledWith(friend().instance, 'desktop')
    expect(openExternal).toHaveBeenCalledWith(launchUrl)
  })

  it('keeps the per-platform join lock global while a launch is in flight', async () => {
    seed()
    let release!: () => void
    openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const first = call('join-instance', joinReq(friend()))
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    release()
    await expect(first).resolves.toEqual({ ok: true, handoff: 'launch' })
  })

  it('allows a different destination immediately but retains the existing per-friend cooldown', async () => {
    const friendB = friend({
      platformUserId: 'usr_bea',
      displayName: 'Bea',
      instance: { ...friend().instance!, instanceId: 'instance-2' }
    })
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend(), friendB], revision)

    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    await expect(call('join-instance', joinReq(friendB))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })

    now += 2_999
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    now += 1
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
  })

  it('returns launch-failed without leaking the rejection and releases the lock', async () => {
    seed()
    let rejectLaunch!: (error: Error) => void
    openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLaunch = reject
        })
    )

    const first = call('join-instance', joinReq(friend()))
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    rejectLaunch(new Error(`could not launch ${launchUrl}`))
    await expect(first).resolves.toEqual({ ok: false, reason: 'launch-failed' })

    openExternal.mockResolvedValueOnce(undefined)
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(log).toHaveBeenCalledWith('warn', 'instance action denied', {
      platform: 'vrchat',
      reason: 'launch-failed'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(launchUrl)
  })

  it('logs only platform and denial reason', async () => {
    await call('join-instance', joinReq(friend()))
    expect(log).toHaveBeenCalledWith('warn', 'instance action denied', {
      platform: 'vrchat',
      reason: 'stale'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('instance-1')
  })

  it('VRX-239 CAS: expected A while authority is at B returns target-changed without building a URL; expected B succeeds from the main-owned B record', async () => {
    const atA = friend()
    const atB = friend({
      instance: {
        ...atA.instance!,
        worldId: 'wrld_moved',
        instanceId: 'instance-moved'
      }
    })
    seed(atA)
    authority.consume({ type: 'friend-presence', platform: 'vrchat', friend: atB })

    await expect(call('join-instance', joinReq(atA))).resolves.toEqual({
      ok: false,
      reason: 'target-changed'
    })
    expect(adapter.buildJoinUrl).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()

    await expect(call('join-instance', joinReq(atB, { mode: 'desktop' }))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(adapter.buildJoinUrl).toHaveBeenCalledWith(atB.instance, 'desktop')
    expect(openExternal).toHaveBeenCalledWith(launchUrl)
  })
})

describe('self-invite handler', () => {
  it('remains available when direct joining is disabled', async () => {
    allowJoinInstances = false
    seed()

    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
    expect(adapter.selfInvite).toHaveBeenCalledWith('wrld_example:instance-1')
  })

  it('is VRChat-only and resolves the instance through the authority', async () => {
    seed()
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
    expect(adapter.selfInvite).toHaveBeenCalledWith('wrld_example:instance-1')
    await expect(
      call('self-invite', { platform: 'chilloutvr', friendId: 'usr_friend' })
    ).rejects.toThrow('Invalid self-invite request')
  })

  it('serializes concurrent calls with an action-specific cooldown', async () => {
    seed()
    let release!: () => void
    vi.mocked(adapter.selfInvite).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const first = call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: false, reason: 'cooldown' })
    expect(adapter.selfInvite).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('does not share its cooldown with join', async () => {
    seed()
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
  })

  it('tracks friend-updated status changes for both instance actions', async () => {
    seed()
    authority.consume({
      type: 'friend-updated',
      platform: 'vrchat',
      friend: friend({ status: 'ask-me', presence: { state: 'offline' }, instance: null })
    })

    await expect(
      call(
        'join-instance',
        joinReq(friend(), { expectedTarget: { worldId: 'wrld_example', instanceId: 'instance-1' } })
      )
    ).resolves.toEqual({ ok: false, reason: 'not-joinable' })
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: false, reason: 'not-joinable' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(adapter.selfInvite).not.toHaveBeenCalled()

    authority.consume({
      type: 'friend-updated',
      platform: 'vrchat',
      friend: friend({ status: 'online', presence: { state: 'offline' }, instance: null })
    })
    await expect(
      call(
        'join-instance',
        joinReq(friend(), { expectedTarget: { worldId: 'wrld_example', instanceId: 'instance-1' } })
      )
    ).resolves.toEqual({ ok: true, handoff: 'launch' })
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
  })

  it('returns invite-failed without leaking the rejection and releases the lock', async () => {
    seed()
    vi.mocked(adapter.selfInvite).mockRejectedValueOnce(
      new Error('invite failed for wrld_example:instance-1')
    )

    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: false, reason: 'invite-failed' })
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: true })
    expect(log).toHaveBeenCalledWith('warn', 'instance action denied', {
      platform: 'vrchat',
      reason: 'invite-failed'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('wrld_example:instance-1')
  })
})

describe('join in a game that is already open', () => {
  let running: Set<Platform>
  let handoffSettings: GameHandoffSettings
  let hostPlatform: NodeJS.Platform
  let sendToVrchat: ReturnType<typeof vi.fn<(url: string) => Promise<boolean>>>
  let cvrAdapter: IPlatformAdapter
  const cvrInstance = 'i+0123456789abcdef-012345-6789ab-01234567'
  const cvrUrl = `chilloutvr://instance/join?instanceId=${encodeURIComponent(cvrInstance)}&startInVR=true`

  function cvrFriend(): Friend {
    return friend({
      platform: 'chilloutvr',
      platformUserId: 'cvr_friend',
      instance: { ...friend().instance!, worldId: 'cvr-world', instanceId: cvrInstance }
    })
  }

  beforeEach(() => {
    handlers.clear()
    running = new Set()
    handoffSettings = { joinOpenGame: true, vrchatOpenGameJoin: 'go' }
    hostPlatform = 'win32'
    sendToVrchat = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(true)
    cvrAdapter = stubPlatformAdapter({ platform: 'chilloutvr' })
    vi.mocked(cvrAdapter.buildJoinUrl).mockReturnValue(cvrUrl)
    registerInstanceHandlers(
      new Map<Platform, IPlatformAdapter>([
        ['vrchat', adapter],
        ['chilloutvr', cvrAdapter]
      ]),
      authority,
      {
        clock: () => now,
        log,
        isJoinAllowed: () => true,
        gameHandoff: new GameHandoff({
          get hostPlatform() {
            return hostPlatform
          },
          isRunning: async (platform) => running.has(platform),
          settings: () => handoffSettings,
          openExternal,
          sendToVrchat
        })
      }
    )
  })

  function seedCvr(target = cvrFriend()): void {
    authority.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })
    const revision = authority.captureSeedRevision('chilloutvr')
    authority.seed('chilloutvr', [target], revision)
  }

  it('launches as before when the game is not open', async () => {
    seed()
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(openExternal).toHaveBeenCalledWith(launchUrl)
    expect(sendToVrchat).not.toHaveBeenCalled()
    expect(adapter.selfInvite).not.toHaveBeenCalled()
  })

  it('hands the VRChat join to the open game on Windows, with no second launch', async () => {
    seed()
    running.add('vrchat')
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'in-game'
    })
    expect(sendToVrchat).toHaveBeenCalledWith(launchUrl)
    expect(openExternal).not.toHaveBeenCalled()
    expect(adapter.selfInvite).not.toHaveBeenCalled()
  })

  it('sends one self-invite to the main-owned location when the game refuses the URL', async () => {
    seed()
    running.add('vrchat')
    sendToVrchat.mockResolvedValue(false)
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'invite'
    })
    expect(adapter.selfInvite).toHaveBeenCalledExactlyOnceWith('wrld_example:instance-1')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('uses a self-invite on Linux and when the user picked invites', async () => {
    seed()
    running.add('vrchat')
    hostPlatform = 'linux'
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'invite'
    })
    now += 3_000
    hostPlatform = 'win32'
    handoffSettings = { joinOpenGame: true, vrchatOpenGameJoin: 'invite' }
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'invite'
    })
    expect(sendToVrchat).not.toHaveBeenCalled()
    expect(adapter.selfInvite).toHaveBeenCalledTimes(2)
  })

  it('reports invite-failed and keeps the destination retryable', async () => {
    seed()
    running.add('vrchat')
    hostPlatform = 'linux'
    vi.mocked(adapter.selfInvite).mockRejectedValueOnce(new Error('403 for wrld_example'))
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: false,
      reason: 'invite-failed'
    })
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'invite'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('wrld_example')
  })

  it('opens the ChilloutVR link, which the open game picks up', async () => {
    seedCvr()
    running.add('chilloutvr')
    await expect(call('join-instance', joinReq(cvrFriend()))).resolves.toEqual({
      ok: true,
      handoff: 'in-game'
    })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(cvrUrl)
    expect(cvrAdapter.selfInvite).not.toHaveBeenCalled()
  })

  it('always launches when the setting is off', async () => {
    seed()
    running.add('vrchat')
    handoffSettings = { joinOpenGame: false, vrchatOpenGameJoin: 'go' }
    await expect(call('join-instance', joinReq(friend()))).resolves.toEqual({
      ok: true,
      handoff: 'launch'
    })
    expect(sendToVrchat).not.toHaveBeenCalled()
  })

  it('previews the handoff for each platform and validates the request', async () => {
    running.add('vrchat')
    running.add('chilloutvr')
    await expect(call('get-join-handoff', { platform: 'vrchat' })).resolves.toBe('in-game')
    await expect(call('get-join-handoff', { platform: 'chilloutvr' })).resolves.toBe('in-game')
    hostPlatform = 'linux'
    await expect(call('get-join-handoff', { platform: 'vrchat' })).resolves.toBe('invite')
    running.clear()
    await expect(call('get-join-handoff', { platform: 'vrchat' })).resolves.toBe('launch')
    await expect(call('get-join-handoff', { platform: 'steam' })).rejects.toThrow(
      'Invalid get-join-handoff request'
    )
    trusted.value = false
    await expect(call('get-join-handoff', { platform: 'vrchat' })).rejects.toThrow(
      'Untrusted IPC sender'
    )
  })
})

describe('self-invite outside a Join', () => {
  it('still refuses a public instance without an API call', async () => {
    seed(friend({ instance: { ...friend().instance!, instanceId: '22222', type: 'public' } }))
    await expect(
      call('self-invite', { platform: 'vrchat', friendId: 'usr_friend' })
    ).resolves.toEqual({ ok: false, reason: 'invite-failed' })
    expect(adapter.selfInvite).not.toHaveBeenCalled()
  })
})
