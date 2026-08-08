import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import type { AdapterEventSource } from './adapterWiring'

import log from './logger'
import { wireAdapterEvents } from './adapterWiring'

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
      broadcast: (received): void => {
        calls.push(`broadcast:${received.type}`)
      }
    })

    source.emit(event)

    expect(calls).toEqual([
      'status:vrchat:live',
      'location:connection',
      'alerts:connection',
      'broadcast:connection'
    ])
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
