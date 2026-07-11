import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, Friend, InstanceInfo, Platform, PresenceState } from '@shared/types'
import { FriendAlerts, type FriendAlert, type FriendAlertType } from './friendAlerts'

const ID = 'usr_friend'

function instance(instanceId: string, worldName: string | null = 'The Great Pug'): InstanceInfo {
  return {
    worldId: `wrld_${instanceId}`,
    instanceId,
    worldName,
    thumbnailUrl: null,
    type: 'public',
    openness: 'public',
    isGroup: false,
    groupName: null,
    region: null,
    userCount: null
  }
}

function inWorld(
  worldId: string,
  instanceId: string,
  worldName: string | null = 'The Great Pug'
): InstanceInfo {
  return { ...instance(instanceId, worldName), worldId }
}

function friend(
  state: PresenceState,
  currentInstance: InstanceInfo | null = null,
  platformUserId = ID,
  displayName = 'FriendName'
): Friend {
  return {
    platformUserId,
    platform: 'vrchat',
    displayName,
    avatarUrl: null,
    presence: { state },
    instance: currentInstance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null
  }
}

function presenceEvent(value: Friend): AdapterEvent {
  return { type: 'friend-presence', platform: value.platform, friend: value }
}

function snapshot(
  entries: Array<{
    platformUserId: string
    state: 'in-game' | 'offline'
    instance: InstanceInfo | null
  }>
): AdapterEvent {
  return {
    type: 'presence-snapshot',
    platform: 'chilloutvr',
    entries: entries.map((entry) => ({
      platformUserId: entry.platformUserId,
      presence: { state: entry.state },
      instance: entry.instance
    }))
  }
}

function harness(options?: {
  enabled?: Partial<Record<FriendAlertType, boolean>>
  names?: Record<string, string>
}): {
  engine: FriendAlerts
  alerts: FriendAlert[]
  setNow: (next: number) => void
  enabled: Record<FriendAlertType, boolean>
  isEnabled: ReturnType<typeof vi.fn>
} {
  let now = 0
  const alerts: FriendAlert[] = []
  const enabled = {
    online: true,
    'in-game': true,
    offline: false,
    ...options?.enabled
  }
  const isEnabled = vi.fn((type: FriendAlertType) => enabled[type])
  return {
    engine: new FriendAlerts({
      notify: (alert) => alerts.push(alert),
      clock: () => now,
      isEnabled,
      resolveName: (_platform: Platform, id: string) => options?.names?.[id] ?? null
    }),
    alerts,
    setNow: (next) => {
      now = next
    },
    enabled,
    isEnabled
  }
}

describe('FriendAlerts transitions', () => {
  it('silently baselines first sight, then emits only real online and instance transitions', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('offline')))
    expect(alerts).toEqual([])

    engine.consume(presenceEvent(friend('active')))
    engine.consume(presenceEvent(friend('active')))
    engine.consume(presenceEvent(friend('in-game', instance('one'))))
    engine.consume(presenceEvent(friend('in-game', instance('one'))))
    engine.consume(presenceEvent(friend('in-game', instance('two', 'Test World'))))

    expect(alerts.map((alert) => [alert.type, alert.worldName])).toEqual([
      ['online', null],
      ['in-game', 'The Great Pug'],
      ['in-game', 'Test World']
    ])
  })

  it('treats a world change as real even when the platform reuses an instance id', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('in-game', inWorld('wrld_one', '123'))))
    engine.consume(presenceEvent(friend('in-game', inWorld('wrld_two', '123', 'Second World'))))
    expect(alerts).toEqual([
      expect.objectContaining({ type: 'in-game', worldName: 'Second World' })
    ])
  })

  it('offline to an unknown in-game destination emits online only', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('in-game', null)))
    expect(alerts).toEqual([expect.objectContaining({ type: 'online', displayName: 'FriendName' })])
  })

  it('A → traveling (unknown) → B emits exactly one in-game alert for B', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('in-game', instance('a', 'World A'))))
    engine.consume(presenceEvent(friend('in-game', null)))
    engine.consume(presenceEvent(friend('in-game', instance('b', 'World B'))))

    expect(alerts).toEqual([expect.objectContaining({ type: 'in-game', worldName: 'World B' })])
  })

  it('offline alerts exist but are disabled by default', () => {
    const { engine, alerts, enabled } = harness()
    engine.consume(presenceEvent(friend('active')))
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: ID })
    expect(alerts).toEqual([])

    enabled.offline = true
    engine.consume(presenceEvent(friend('active')))
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: ID })
    expect(alerts.at(-1)).toMatchObject({ type: 'offline', displayName: 'FriendName' })
  })

  it('reconnect clears presence and silently re-baselines each friend', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('active')))
    expect(alerts).toHaveLength(1)

    engine.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    engine.consume(presenceEvent(friend('in-game', instance('new'))))
    expect(alerts).toHaveLength(1)
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: ID })
    engine.consume(presenceEvent(friend('active')))
    expect(alerts.map((alert) => alert.type)).toEqual(['online', 'online'])
  })

  it('auth invalidation fully resets names and silently baselines a late old-socket event', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('active')))
    expect(alerts).toHaveLength(1)

    engine.consume({ type: 'auth-invalidated', platform: 'vrchat' })
    engine.consume(presenceEvent(friend('in-game', instance('late'))))

    expect(alerts).toHaveLength(1)
  })

  it('bounds per-platform presence tombstones with oldest-first eviction', () => {
    const { engine, alerts } = harness()
    for (let index = 0; index <= 2_048; index++) {
      engine.consume(presenceEvent(friend('offline', null, `usr_${index}`, `Friend ${index}`)))
    }

    // usr_0 was the oldest entry and was evicted; seeing it again is a silent
    // first sight instead of a synthetic offline→online transition.
    engine.consume(presenceEvent(friend('active', null, 'usr_0', 'Friend 0')))
    expect(alerts).toEqual([])
  })

  it('bounds retained names in the reviewer 10000-id online-to-offline replay shape', () => {
    const live = harness()
    for (let index = 0; index < 10_000; index++) {
      live.engine.consume(
        presenceEvent(friend('active', null, `usr_live_${index}`, `Live Friend ${index}`))
      )
    }
    const liveState = live.engine as unknown as {
      presence: Map<Platform, Map<string, unknown>>
      names: Map<Platform, Map<string, string>>
    }
    expect(liveState.names.get('vrchat')?.size ?? 0).toBeLessThanOrEqual(2_048)
    // Live-only streams are hard-capped too: with silent first-sight
    // baselining, evicting the oldest live entry can only MISS an alert at
    // pathological roster scale, never fabricate one.
    expect(liveState.presence.get('vrchat')?.size ?? 0).toBeLessThanOrEqual(2_048)

    const replay = harness()
    for (let index = 0; index < 10_000; index++) {
      const id = `usr_${index}`
      replay.engine.consume(presenceEvent(friend('active', null, id, `Friend ${index}`)))
      replay.engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: id })
    }
    const state = replay.engine as unknown as {
      presence: Map<Platform, Map<string, unknown>>
      names: Map<Platform, Map<string, string>>
    }
    expect(state.presence.get('vrchat')?.size ?? 0).toBeLessThanOrEqual(2_048)
    expect(state.names.get('vrchat')?.size ?? 0).toBeLessThanOrEqual(2_048)
  })
})

describe('FriendAlerts CVR snapshot diffing', () => {
  const CVR_ID = 'a1b2c3d4-0000-0000-0000-000000000001'

  it('silently baselines the first full set, diffs absences as offline, and later additions as online', () => {
    const { engine, alerts } = harness({
      enabled: { offline: true },
      names: { [CVR_ID]: 'Trinity' }
    })
    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('a') }])
    )
    expect(alerts).toEqual([])

    engine.consume(snapshot([]))
    expect(alerts.map((alert) => alert.type)).toEqual(['offline'])

    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('b') }])
    )
    expect(alerts.map((alert) => alert.type)).toEqual(['offline', 'online', 'in-game'])
  })

  it('re-baselines the first snapshot after connection live', () => {
    const { engine, alerts } = harness({ names: { [CVR_ID]: 'Trinity' } })
    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('initial') }])
    )
    engine.consume(snapshot([]))
    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('a') }])
    )
    expect(alerts).toHaveLength(2)

    engine.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })
    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('b') }])
    )
    expect(alerts).toHaveLength(2)
  })

  it('does not treat asynchronous CVR world enrichment as a movement transition', () => {
    const { engine, alerts } = harness({ names: { [CVR_ID]: 'Trinity' } })
    engine.consume(
      snapshot([{ platformUserId: CVR_ID, state: 'in-game', instance: instance('initial') }])
    )
    engine.consume(snapshot([]))
    engine.consume(
      snapshot([
        {
          platformUserId: CVR_ID,
          state: 'in-game',
          instance: inWorld('instance-guid', 'instance-guid', 'Raw Instance')
        }
      ])
    )
    expect(alerts).toHaveLength(2)
    expect(alerts.find((alert) => alert.type === 'in-game')).toMatchObject({ worldName: null })

    engine.consume(
      snapshot([
        {
          platformUserId: CVR_ID,
          state: 'in-game',
          instance: inWorld('world-guid', 'instance-guid', 'Resolved World')
        }
      ])
    )
    expect(alerts).toHaveLength(2)
  })

  it('silently baselines every never-seen id in a multi-add snapshot', () => {
    const secondId = 'a1b2c3d4-0000-0000-0000-000000000002'
    const { engine, alerts } = harness({
      names: { [CVR_ID]: 'Trinity', [secondId]: 'Morpheus' }
    })
    engine.consume(snapshot([]))
    engine.consume({ type: 'roster-changed', platform: 'chilloutvr' })
    engine.consume(
      snapshot([
        { platformUserId: CVR_ID, state: 'in-game', instance: instance('accepted') },
        { platformUserId: secondId, state: 'in-game', instance: instance('also-accepted') }
      ])
    )
    expect(alerts).toEqual([])

    engine.consume(snapshot([]))
    engine.consume(
      snapshot([
        { platformUserId: CVR_ID, state: 'in-game', instance: instance('returned') },
        { platformUserId: secondId, state: 'in-game', instance: instance('also-returned') }
      ])
    )
    expect(alerts.map((alert) => alert.type)).toEqual(['online', 'in-game', 'online', 'in-game'])
  })

  it('replaying an identical 2049-entry live snapshot produces zero alerts', () => {
    const entries = Array.from({ length: 2_049 }, (_, index) => ({
      platformUserId: `cvr-${index}`,
      state: 'in-game' as const,
      instance: instance(`instance-${index}`)
    }))
    const { engine, alerts } = harness({
      names: Object.fromEntries(
        entries.map((entry) => [entry.platformUserId, entry.platformUserId])
      )
    })

    engine.consume(snapshot(entries))
    engine.consume(snapshot(entries))

    expect(alerts).toEqual([])
  })
})

describe('FriendAlerts policy injection', () => {
  it('reads toggles at fire time and still advances presence while disabled', () => {
    const { engine, alerts, enabled, isEnabled } = harness({ enabled: { online: false } })
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('active')))
    enabled.online = true
    engine.consume(presenceEvent(friend('active')))
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('active')))

    expect(alerts.map((alert) => alert.type)).toEqual(['online'])
    expect(isEnabled).toHaveBeenCalledWith('online')
  })

  it('limits online and in-game independently to 3 per 10 seconds and counts dropped alerts', () => {
    const { engine, alerts, setNow } = harness()
    for (let index = 0; index < 4; index++) {
      const id = `usr_${index}`
      engine.consume(presenceEvent(friend('offline', null, id, `Friend ${index}`)))
      engine.consume(
        presenceEvent(friend('in-game', instance(`world_${index}`), id, `Friend ${index}`))
      )
    }
    expect(alerts.filter((alert) => alert.type === 'online')).toHaveLength(3)
    expect(alerts.filter((alert) => alert.type === 'in-game')).toHaveLength(3)
    expect(engine.getDroppedCount('online')).toBe(1)
    expect(engine.getDroppedCount('in-game')).toBe(1)
    expect(engine.getDroppedCount()).toBe(2)

    setNow(10_000)
    engine.consume(presenceEvent(friend('offline', null, 'usr_4', 'Friend 4')))
    engine.consume(presenceEvent(friend('active', null, 'usr_4', 'Friend 4')))
    expect(alerts.filter((alert) => alert.type === 'online')).toHaveLength(4)
  })

  it('rate-limits enabled offline alerts to 3 per 10 seconds and counts drops', () => {
    const { engine, alerts } = harness({ enabled: { offline: true } })
    for (let index = 0; index < 4; index++) {
      const id = `usr_offline_${index}`
      engine.consume(presenceEvent(friend('active', null, id, `Friend ${index}`)))
      engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: id })
    }

    expect(alerts.filter((alert) => alert.type === 'offline')).toHaveLength(3)
    expect(engine.getDroppedCount('offline')).toBe(1)
    expect(engine.getDroppedCount()).toBe(1)
  })
})
