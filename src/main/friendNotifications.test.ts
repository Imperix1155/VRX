import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendAlert } from './services/friendAlerts'

type NotificationListener = () => void

const electron = vi.hoisted(() => {
  class MockNotification {
    static instances: MockNotification[] = []
    static supported = true
    static showError: Error | null = null

    readonly listeners = new Map<string, Array<{ listener: NotificationListener; once: boolean }>>()
    readonly show = vi.fn(() => {
      if (MockNotification.showError !== null) throw MockNotification.showError
    })

    constructor(readonly options: { title: string; body: string; icon: string }) {
      MockNotification.instances.push(this)
    }

    static isSupported(): boolean {
      return MockNotification.supported
    }

    on(event: string, listener: NotificationListener): this {
      this.addListener(event, listener, false)
      return this
    }

    once(event: string, listener: NotificationListener): this {
      this.addListener(event, listener, true)
      return this
    }

    emit(event: string): void {
      const registrations = this.listeners.get(event) ?? []
      this.listeners.set(
        event,
        registrations.filter(({ once }) => !once)
      )
      for (const { listener } of registrations) listener()
    }

    private addListener(event: string, listener: NotificationListener, once: boolean): void {
      const registrations = this.listeners.get(event) ?? []
      registrations.push({ listener, once })
      this.listeners.set(event, registrations)
    }
  }

  return { MockNotification }
})

vi.mock('electron', () => ({ Notification: electron.MockNotification }))

import { createFriendNotificationNotifier, notificationPresenter } from './friendNotifications'

const transitionAlert = (
  type: 'online' | 'in-game' | 'offline',
  worldName: string | null = null
): FriendAlert => ({
  type,
  platform: 'vrchat',
  platformUserId: 'usr_123',
  displayName: 'Ada',
  worldName
})

const hotAlert = (friendCount: number, worldName: string | null = null): FriendAlert => ({
  type: 'hot-instance',
  platform: 'vrchat',
  instanceId: 'instance-123',
  friendCount,
  worldName
})

describe('notificationPresenter', () => {
  it.each([
    ['online', transitionAlert('online'), { title: 'Friend Online', body: 'Ada came online' }],
    [
      'in-game',
      transitionAlert('in-game', "Bono's Movie Night"),
      { title: 'Friend Joined a World', body: "Ada joined Bono's Movie Night" }
    ],
    ['offline', transitionAlert('offline'), { title: 'Friend Offline', body: 'Ada went offline' }],
    [
      'hot-instance',
      hotAlert(4, "Bono's Movie Night"),
      {
        title: 'Friends Gathering',
        body: "4 friends are together in Bono's Movie Night — join them?"
      }
    ]
  ] as const)('presents %s alerts as owner-authored title/body copy', (_type, alert, expected) => {
    expect(notificationPresenter(alert)).toEqual(expected)
  })

  it('strips trailing instance labels and uses worldless in-game copy for an empty result', () => {
    expect(notificationPresenter(transitionAlert('in-game', 'World Name (#private)'))).toEqual({
      title: 'Friend Joined a World',
      body: 'Ada joined World Name'
    })
    expect(notificationPresenter(transitionAlert('in-game', ' (#private) '))).toEqual({
      title: 'Friend Joined a World',
      body: 'Ada joined a world'
    })
  })

  it('uses truthful singular and worldless hot-instance copy', () => {
    expect(notificationPresenter(hotAlert(1, null))).toEqual({
      title: 'Friends Gathering',
      body: '1 friend is in the same instance — join them?'
    })
  })

  it('strips trailing instance labels from hot-instance world copy', () => {
    expect(notificationPresenter(hotAlert(4, 'World Name (#private)'))).toEqual({
      title: 'Friends Gathering',
      body: '4 friends are together in World Name — join them?'
    })
  })
})

describe('createFriendNotificationNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electron.MockNotification.instances = []
    electron.MockNotification.supported = true
    electron.MockNotification.showError = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates and shows an icon-bearing native notification with type-specific click routing', () => {
    const focusMainWindow = vi.fn()
    const focusDashboard = vi.fn()
    const notify = createFriendNotificationNotifier({
      icon: '/packaged/icon.png',
      focusMainWindow,
      focusDashboard,
      logFailure: vi.fn()
    })

    notify(transitionAlert('online'))
    notify(hotAlert(3, 'The Great Pug'))

    expect(electron.MockNotification.instances[0]?.options).toEqual({
      title: 'Friend Online',
      body: 'Ada came online',
      icon: '/packaged/icon.png'
    })
    expect(electron.MockNotification.instances[1]?.options).toEqual({
      title: 'Friends Gathering',
      body: '3 friends are together in The Great Pug — join them?',
      icon: '/packaged/icon.png'
    })
    expect(electron.MockNotification.instances[0]?.show).toHaveBeenCalledOnce()
    expect(electron.MockNotification.instances[1]?.show).toHaveBeenCalledOnce()

    electron.MockNotification.instances[0]?.emit('click')
    electron.MockNotification.instances[1]?.emit('click')
    expect(focusMainWindow).toHaveBeenCalledOnce()
    expect(focusDashboard).toHaveBeenCalledOnce()
  })

  it('releases retained timers on close and failure without logging private native errors', () => {
    const logFailure = vi.fn()
    const notify = createFriendNotificationNotifier({
      icon: '/packaged/icon.png',
      focusMainWindow: vi.fn(),
      focusDashboard: vi.fn(),
      logFailure
    })

    notify(transitionAlert('online'))
    notify(transitionAlert('offline'))
    expect(vi.getTimerCount()).toBe(2)

    electron.MockNotification.instances[0]?.emit('close')
    expect(vi.getTimerCount()).toBe(1)

    electron.MockNotification.instances[1]?.emit('failed')
    expect(vi.getTimerCount()).toBe(0)
    expect(logFailure).toHaveBeenCalledOnce()
    expect(logFailure).toHaveBeenCalledWith()
  })

  it('releases retention and logs without throwing when native show fails synchronously', () => {
    const logFailure = vi.fn()
    const notify = createFriendNotificationNotifier({
      icon: '/packaged/icon.png',
      focusMainWindow: vi.fn(),
      focusDashboard: vi.fn(),
      logFailure
    })
    electron.MockNotification.showError = new Error('native show failed')

    expect(() => notify(transitionAlert('online'))).not.toThrow()
    expect(electron.MockNotification.instances[0]?.show).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(logFailure).toHaveBeenCalledOnce()
    expect(logFailure).toHaveBeenCalledWith()

    electron.MockNotification.showError = null
    for (let index = 0; index < 21; index += 1) notify(transitionAlert('online'))
    expect(vi.getTimerCount()).toBe(20)
    expect(logFailure).toHaveBeenCalledOnce()
  })

  it('evicts the oldest retained notification when the 20-entry cap is exceeded', () => {
    const notify = createFriendNotificationNotifier({
      icon: '/packaged/icon.png',
      focusMainWindow: vi.fn(),
      focusDashboard: vi.fn(),
      logFailure: vi.fn()
    })

    for (let index = 0; index < 21; index += 1) notify(transitionAlert('online'))

    expect(electron.MockNotification.instances).toHaveLength(21)
    expect(vi.getTimerCount()).toBe(20)

    electron.MockNotification.instances[0]?.emit('close')
    expect(vi.getTimerCount()).toBe(20)
    electron.MockNotification.instances[1]?.emit('close')
    expect(vi.getTimerCount()).toBe(19)
  })
})
