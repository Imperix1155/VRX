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

  it('offline to in-game emits both online and in-game, including the worldless variant data', () => {
    const { engine, alerts } = harness()
    engine.consume(presenceEvent(friend('offline')))
    engine.consume(presenceEvent(friend('in-game', instance('private', null))))
    expect(alerts).toEqual([
      expect.objectContaining({ type: 'online', displayName: 'FriendName' }),
      expect.objectContaining({ type: 'in-game', displayName: 'FriendName', worldName: null })
    ])
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
})
