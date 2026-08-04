import { Notification as NativeNotification } from 'electron'
import type { FriendAlert } from './services/friendAlerts'

const INSTANCE_LABEL_SUFFIX = /\s*\(#[^)]*\)\s*$/
const MAX_RETAINED_FRIEND_NOTIFICATIONS = 20
const FRIEND_NOTIFICATION_RETENTION_MS = 60_000

export interface NotificationPresentation {
  title: string
  body: string
}

export interface FriendNotificationOptions {
  icon: string
  focusMainWindow: () => void
  focusDashboard: () => void
  logFailure: () => void
}

const strippedWorldName = (worldName: string | null): string =>
  worldName?.replace(INSTANCE_LABEL_SUFFIX, '').trim() ?? ''

export function notificationPresenter(alert: FriendAlert): NotificationPresentation {
  switch (alert.type) {
    case 'online':
      return { title: 'Friend Online', body: `${alert.displayName} came online` }
    case 'in-game': {
      const worldName = strippedWorldName(alert.worldName)
      return {
        title: 'Friend Joined a World',
        body:
          worldName === ''
            ? `${alert.displayName} joined a world`
            : `${alert.displayName} joined ${worldName}`
      }
    }
    case 'offline':
      return { title: 'Friend Offline', body: `${alert.displayName} went offline` }
    case 'hot-instance': {
      const worldName = strippedWorldName(alert.worldName)
      const countCopy = alert.friendCount === 1 ? '1 friend is' : `${alert.friendCount} friends are`
      return {
        title: 'Friends Gathering',
        body:
          worldName === ''
            ? `${countCopy} in the same instance — join them?`
            : `${countCopy} together in ${worldName} — join them?`
      }
    }
  }
}

export function createFriendNotificationNotifier({
  icon,
  focusMainWindow,
  focusDashboard,
  logFailure
}: FriendNotificationOptions): (alert: FriendAlert) => void {
  const retained = new Map<NativeNotification, ReturnType<typeof setTimeout>>()

  const release = (notification: NativeNotification): void => {
    const timer = retained.get(notification)
    if (timer !== undefined) clearTimeout(timer)
    retained.delete(notification)
  }

  return (alert): void => {
    if (!NativeNotification.isSupported()) return

    try {
      const { title, body } = notificationPresenter(alert)
      const notification = new NativeNotification({ title, body, icon })
      notification.on('click', alert.type === 'hot-instance' ? focusDashboard : focusMainWindow)
      const cleanup = (): void => release(notification)
      notification.once('close', cleanup)
      notification.once('failed', () => {
        logFailure()
        cleanup()
      })
      const cleanupTimer = setTimeout(cleanup, FRIEND_NOTIFICATION_RETENTION_MS)
      cleanupTimer.unref()
      retained.set(notification, cleanupTimer)
      if (retained.size > MAX_RETAINED_FRIEND_NOTIFICATIONS) {
        const oldest = retained.keys().next().value
        if (oldest !== undefined) release(oldest)
      }
      try {
        notification.show()
      } catch (error) {
        cleanup()
        throw error
      }
    } catch {
      logFailure()
    }
  }
}
