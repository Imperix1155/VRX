import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BroadcastAdapterEvent } from '@shared/ipc'
import type { AdapterEvent, ConnectionHealth, Friend, Platform, VrcFriend } from '@shared/types'
import type { AdapterEventSource } from './adapterWiring'

import log from './logger'
import { wireAdapterEvents } from './adapterWiring'
import { stubPlatformAdapter } from './services/adapters/__testutils__/adapterTestKit'
import { ActivityFeed } from './services/activityFeed'
import { AppStatusService } from './services/appStatus'
import { FriendAlerts, type FriendAlert } from './services/friendAlerts'
import { createFriendRosterReader } from './services/friendRoster'
import { LocationAuthority } from './services/locationAuthority'
import { RosterCatchUp } from './rosterCatchUp'

vi.mock('./logger', () => ({
  default: {
    warn: vi.fn()
  }
}))

type AdapterListener = (event: AdapterEvent) => void

function fakeAdapter(): {
  adapter: AdapterEventSource
  emit: (event: AdapterEvent) => void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: AdapterListener | null = null
  const unsubscribe = vi.fn(() => {
    listener = null
  })
  return {
    adapter: {
      subscribe: vi.fn((nextListener: AdapterListener) => {
        listener = nextListener
        return unsubscribe
      })
    },
    emit: (event): void => listener?.(event),
    unsubscribe
  }
}

describe('wireAdapterEvents', () => {
  beforeEach(() => {
    // log.warn is a shared module-level mock — without this, exactly-one-call
    // assertions in the isolation tests would pass on residue from earlier tests.
    vi.clearAllMocks()
  })

  it('records connection health before location, alerts, and renderer fan-out', () => {
    const calls: string[] = []
    const source = fakeAdapter()
    const event: AdapterEvent = { type: 'connection', platform: 'vrchat', health: 'live' }

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: {
        recordConnection: (platform, health): void => {
          calls.push(`status:${platform}:${health}`)
        }
      },
      locationAuthority: {
        consume: (received): void => {
          calls.push(`location:${received.type}`)
        }
      },
      friendAlerts: {
        consume: (received): void => {
          calls.push(`alerts:${received.type}`)
        }
      },
      activityFeed: {
        consume: (received): void => {
          calls.push(`activity:${received.type}`)
        }
      },
      inbox: {
        consume: (received): void => {
          calls.push(`inbox:${received.type}`)
        }
      },
      broadcast: (received): void => {
        calls.push(`broadcast:${received.type}`)
      }
    })

    source.emit(event)

    expect(calls).toEqual([
      'status:vrchat:live',
      'location:connection',
      'alerts:connection',
      'activity:connection',
      'inbox:connection',
      'broadcast:connection'
    ])
  })

  it('sends inbox changes to the inbox only, never to presence, alerts, activity, or the renderer', () => {
    const source = fakeAdapter()
    const consumers = {
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast: vi.fn()
    }
    const event: AdapterEvent = { type: 'inbox', platform: 'vrchat', change: { op: 'clear' } }

    wireAdapterEvents({ sources: [source.adapter], ...consumers })
    source.emit(event)

    expect(consumers.inbox.consume).toHaveBeenCalledWith(event)
    expect(consumers.locationAuthority.consume).not.toHaveBeenCalled()
    expect(consumers.friendAlerts.consume).not.toHaveBeenCalled()
    expect(consumers.activityFeed.consume).not.toHaveBeenCalled()
    expect(consumers.broadcast).not.toHaveBeenCalled()
  })

  it('isolates inbox.consume so broadcast still runs on throw', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = { type: 'roster-changed', platform: 'chilloutvr' }
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: {
        consume: (): void => {
          throw new Error('inbox boom')
        }
      },
      broadcast
    })

    source.emit(event)

    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'inbox',
      eventType: 'roster-changed',
      error: 'inbox boom'
    })
  })

  it('does not record status for non-connection events', () => {
    const source = fakeAdapter()
    const recordConnection = vi.fn()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'chilloutvr',
      platformUserId: 'friend-123'
    }

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast: vi.fn()
    })

    source.emit(event)

    expect(recordConnection).not.toHaveBeenCalled()
  })

  it('teardown unsubscribes every source and detaches its listener', () => {
    const vrc = fakeAdapter()
    const cvr = fakeAdapter()
    const broadcast = vi.fn()
    const teardown = wireAdapterEvents({
      sources: [vrc.adapter, cvr.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })
    const event: AdapterEvent = { type: 'roster-changed', platform: 'chilloutvr' }

    vrc.emit(event)
    cvr.emit(event)
    expect(broadcast).toHaveBeenCalledTimes(2)

    teardown()
    expect(vrc.unsubscribe).toHaveBeenCalledOnce()
    expect(cvr.unsubscribe).toHaveBeenCalledOnce()

    vrc.emit(event)
    cvr.emit(event)
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('isolates locationAuthority.consume so friendAlerts and broadcast still run on throw', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-presence',
      platform: 'vrchat',
      friend: {
        platform: 'vrchat',
        platformUserId: 'u1',
        displayName: 'User',
        avatarUrl: null,
        status: 'online',
        statusDescription: null,
        trustRank: null,
        presence: { state: 'active' },
        instance: null,
        isFavorite: false,
        favoriteGroupIds: [],
        linkedPersonId: null
      }
    }
    const friendAlertsConsume = vi.fn()
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: {
        consume: (): void => {
          throw new Error('location authority boom')
        }
      },
      friendAlerts: { consume: friendAlertsConsume },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    source.emit(event)

    expect(friendAlertsConsume).toHaveBeenCalledWith(event)
    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'locationAuthority',
      eventType: 'friend-presence',
      error: 'location authority boom'
    })
  })

  it('isolates friendAlerts.consume so broadcast still runs on throw', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'chilloutvr',
      platformUserId: 'u2'
    }
    const locationAuthorityConsume = vi.fn()
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: locationAuthorityConsume },
      friendAlerts: {
        consume: (): void => {
          throw new Error('friend alerts boom')
        }
      },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    source.emit(event)

    expect(locationAuthorityConsume).toHaveBeenCalledWith(event)
    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'friendAlerts',
      eventType: 'friend-offline',
      error: 'friend alerts boom'
    })
  })

  it('a hostile throw value cannot escape the guard — broadcast still runs', () => {
    // String() itself throws for null-prototype objects; without a total
    // formatter the guard's own catch block would rethrow and reinstate the
    // dropped-broadcast defect through the safety net itself.
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'chilloutvr',
      platformUserId: 'u5'
    }
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: {
        consume: (): void => {
          throw Object.create(null)
        }
      },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    expect(() => source.emit(event)).not.toThrow()
    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'locationAuthority',
      eventType: 'friend-offline',
      error: '[unformattable error]'
    })
  })

  it('a throwing logger cannot escape the guard — broadcast still runs', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'u7'
    }
    const broadcast = vi.fn()
    vi.mocked(log.warn).mockImplementationOnce(() => {
      throw new Error('log transport boom')
    })

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: {
        consume: (): void => {
          throw new Error('location boom')
        }
      },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    expect(() => source.emit(event)).not.toThrow()
    expect(broadcast).toHaveBeenCalledWith(event)
  })

  it('two consumers throwing on the same event still reach broadcast, with one warn each', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'u6'
    }
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: {
        consume: (): void => {
          throw new Error('location boom')
        }
      },
      friendAlerts: {
        consume: (): void => {
          throw new Error('alerts boom')
        }
      },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    source.emit(event)

    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('isolates appStatus.recordConnection so a connection event still fans out on throw', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = { type: 'connection', platform: 'vrchat', health: 'live' }
    const broadcast = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: {
        recordConnection: (): void => {
          throw new Error('status boom')
        }
      },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast
    })

    expect(() => source.emit(event)).not.toThrow()
    expect(broadcast).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'appStatus',
      eventType: 'connection',
      error: 'status boom'
    })
  })

  it('isolates broadcast so a throw does not escape the handler', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'u3'
    }
    const locationAuthorityConsume = vi.fn()
    const friendAlertsConsume = vi.fn()

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: locationAuthorityConsume },
      friendAlerts: { consume: friendAlertsConsume },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast: (): void => {
        throw new Error('broadcast boom')
      }
    })

    expect(() => source.emit(event)).not.toThrow()
    expect(locationAuthorityConsume).toHaveBeenCalledWith(event)
    expect(friendAlertsConsume).toHaveBeenCalledWith(event)
    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'broadcast',
      eventType: 'friend-offline',
      error: 'broadcast boom'
    })
  })

  it('reformats non-Error throws to strings in the warning log', () => {
    const source = fakeAdapter()
    const event: AdapterEvent = {
      type: 'friend-offline',
      platform: 'chilloutvr',
      platformUserId: 'u4'
    }

    wireAdapterEvents({
      sources: [source.adapter],
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: {
        consume: (): void => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'stringy failure'
        }
      },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast: vi.fn()
    })

    source.emit(event)

    expect(log.warn).toHaveBeenCalledWith('adapter event consumer failed', {
      consumer: 'locationAuthority',
      eventType: 'friend-offline',
      error: 'stringy failure'
    })
  })
})

describe('wireAdapterEvents roster catch-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function alice(state: Friend['presence']['state']): VrcFriend {
    return {
      platform: 'vrchat',
      platformUserId: 'usr_alice',
      displayName: 'Alice',
      avatarUrl: null,
      status: 'online',
      statusDescription: null,
      trustRank: null,
      presence: { state },
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    }
  }

  type Consume = Mock<(event: AdapterEvent) => void>

  function consumers(): {
    appStatus: { recordConnection: Mock<(platform: Platform, health: ConnectionHealth) => void> }
    locationAuthority: { consume: Consume }
    friendAlerts: { consume: Consume }
    activityFeed: { consume: Consume }
    inbox: { consume: Consume }
    broadcast: Mock<(event: BroadcastAdapterEvent) => void>
  } {
    return {
      appStatus: { recordConnection: vi.fn() },
      locationAuthority: { consume: vi.fn() },
      friendAlerts: { consume: vi.fn() },
      activityFeed: { consume: vi.fn() },
      inbox: { consume: vi.fn() },
      broadcast: vi.fn()
    }
  }

  it('with no window open, a reconnect reads the roster so the next change still alerts', async () => {
    const source = fakeAdapter()
    const alerts: FriendAlert[] = []
    const friendAlerts = new FriendAlerts({
      notify: (alert) => alerts.push(alert),
      clock: () => 0,
      isEnabled: () => true,
      resolveName: () => null
    })
    const activityFeed = new ActivityFeed({
      now: () => 0,
      clock: () => 0,
      isEnabled: () => true,
      resolveName: () => null,
      onChanged: () => undefined
    })
    const adapter = stubPlatformAdapter({
      getFriends: vi
        .fn()
        .mockResolvedValue({ friends: [alice('offline')], completeness: 'complete' })
    })
    const locationAuthority = new LocationAuthority()
    // The same hand-off as app.ts `onFriendRoster`.
    const readRoster = createFriendRosterReader(
      new Map([['vrchat', adapter]]),
      locationAuthority,
      new AppStatusService(() => 0),
      (platform, friends) => {
        friendAlerts.seedRoster(platform, friends)
        activityFeed.seedRoster(platform, friends)
      }
    )
    wireAdapterEvents({
      sources: [source.adapter],
      ...consumers(),
      locationAuthority,
      friendAlerts,
      activityFeed,
      rosterCatchUp: new RosterCatchUp({
        hasWindow: () => false,
        readRoster,
        logFailure: vi.fn()
      })
    })
    await readRoster('vrchat')
    vi.mocked(adapter.getFriends).mockClear()

    // macOS keeps VRX running with its window closed; the socket reconnects.
    source.emit({ type: 'connection', platform: 'vrchat', health: 'live' })
    expect(adapter.getFriends).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 0))
    source.emit({ type: 'friend-presence', platform: 'vrchat', friend: alice('active') })

    expect(alerts.map((alert) => alert.type)).toEqual(['online'])
    expect(activityFeed.list().map((entry) => entry.kind)).toEqual(['online'])
  })

  it('runs after main has seen the event and before the broadcast, isolated', () => {
    const source = fakeAdapter()
    const calls: string[] = []
    const wiring = consumers()
    wiring.inbox.consume.mockImplementation((event) => {
      calls.push(`inbox:${event.type}`)
    })
    wiring.broadcast.mockImplementation((event) => {
      calls.push(`broadcast:${event.type}`)
    })
    wireAdapterEvents({
      sources: [source.adapter],
      ...wiring,
      rosterCatchUp: {
        consume: (event): void => {
          calls.push(`catchUp:${event.type}`)
          throw new Error('catch-up boom')
        }
      }
    })

    source.emit({ type: 'connection', platform: 'chilloutvr', health: 'live' })

    expect(calls).toEqual(['inbox:connection', 'catchUp:connection', 'broadcast:connection'])
    expect(log.warn).toHaveBeenCalledExactlyOnceWith('adapter event consumer failed', {
      consumer: 'rosterCatchUp',
      eventType: 'connection',
      error: 'catch-up boom'
    })
  })
})
