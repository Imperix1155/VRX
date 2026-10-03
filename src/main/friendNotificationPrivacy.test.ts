import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { VrcAdapter } from './services/adapters/VrcAdapter'
import { WorldResolver } from './services/adapters/vrchat/WorldResolver'
import { FriendAlerts, type FriendAlert } from './services/friendAlerts'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './services/adapters/__testutils__/adapterTestKit'
import { isFriendAlertEnabled, notificationPresenter } from './friendNotifications'

vi.mock('electron', () => ({ Notification: class {} }))

class Socket {
  listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  close(): void {
    this.fire('close')
  }
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('live pipeline notification privacy', () => {
  it.each(['ask me', 'busy', 'active'])(
    'masks hidden cached world metadata while preserving online alerts (%s)',
    async (status) => {
      const alerts: FriendAlert[] = []
      const settings = { ...DEFAULT_SETTINGS, notifyFriendOnline: true, notifyFriendInGame: true }
      const engine = new FriendAlerts({
        clock: () => 0,
        isEnabled: (type) => isFriendAlertEnabled(type, settings),
        resolveName: () => null,
        notify: (alert) => alerts.push(alert)
      })
      const socket = new Socket()
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith('/auth'))
          return Promise.resolve(jsonResponse({ token: 'synthetic-token' }))
        if (url.includes('/worlds/'))
          return Promise.resolve(jsonResponse({ name: 'Hidden cached world', capacity: 10 }))
        return Promise.reject(new Error('Unexpected synthetic request'))
      })
      vi.stubGlobal('fetch', fetchMock)
      const adapter = new VrcAdapter(
        { load: () => 'auth=synthetic', save: () => {}, delete: () => {} },
        instantAdmission(),
        {
          socketFactory: () => socket
        }
      )
      markVrcSessionEstablished(adapter)
      const unsubscribe = adapter.subscribe((event) => engine.consume(event))
      try {
        await vi.waitFor(() => expect(socket.listeners.has('message')).toBe(true))
        socket.fire('open')
        const resolver = (adapter as unknown as { worldResolver: WorldResolver }).worldResolver
        await resolver.resolve('wrld_synthetic')
        const user = { id: 'usr_synthetic', displayName: 'Synthetic Friend', status, tags: [] }
        const send = (type: string, content: unknown): void =>
          socket.fire('message', JSON.stringify({ type, content: JSON.stringify(content) }))
        send('friend-offline', { userId: user.id })
        send('friend-online', { userId: user.id, user, location: 'wrld_synthetic:12345' })
        expect(alerts.map((alert) => alert.type)).toEqual(['online', 'in-game'])
        const presented = alerts.map(notificationPresenter)
        expect(presented[0]?.body).toBe('Synthetic Friend came online')
        expect(presented[1]?.body).toBe(
          status === 'active'
            ? 'Synthetic Friend joined Hidden cached world'
            : 'Synthetic Friend joined a world'
        )
        if (status !== 'active')
          expect(alerts.every((alert) => alert.worldName === null)).toBe(true)
        expect(isFriendAlertEnabled('in-game', DEFAULT_SETTINGS)).toBe(false)
        expect(isFriendAlertEnabled('online', DEFAULT_SETTINGS)).toBe(false)
      } finally {
        unsubscribe()
      }
    }
  )
})
