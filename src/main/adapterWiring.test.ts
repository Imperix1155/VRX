import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import type { AdapterEventSource } from './adapterWiring'

import { wireAdapterEvents } from './adapterWiring'

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
})
