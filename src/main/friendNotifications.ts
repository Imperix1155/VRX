import { Notification as NativeNotification } from 'electron'
import type { Settings } from '@shared/settings'
import type { Platform } from '@shared/types'
import type { FriendAlert, FriendAlertType } from './services/friendAlerts'
import { mt } from './i18n'

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
  /** Open Hot Instances so the clicked alert's platform is in view. */
  focusDashboard: (platform: Platform) => void
  logFailure: () => void
}

const strippedWorldName = (worldName: string | null): string =>
  worldName?.replace(INSTANCE_LABEL_SUFFIX, '').trim() ?? ''

export function notificationPresenter(alert: FriendAlert): NotificationPresentation {
  switch (alert.type) {
    case 'online':
      return {
        title: mt('notify.online.title'),
        body: mt('notify.online.body', { name: alert.displayName })
      }
    case 'in-game': {
      const worldName = strippedWorldName(alert.worldName)
      return {
        title: mt('notify.inGame.title'),
        body:
          worldName === ''
            ? mt('notify.inGame.bodyNoWorld', { name: alert.displayName })
            : mt('notify.inGame.body', { name: alert.displayName, world: worldName })
      }
    }
    case 'offline':
      return {
        title: mt('notify.offline.title'),
        body: mt('notify.offline.body', { name: alert.displayName })
      }
    case 'hot-instance': {
      const worldName = strippedWorldName(alert.worldName)
      const count = alert.friendCount
      const one = count === 1
      return {
        title: mt('notify.hot.title'),
        body:
          worldName === ''
            ? mt(one ? 'notify.hot.bodyNoWorld_one' : 'notify.hot.bodyNoWorld_other', { count })
            : mt(one ? 'notify.hot.body_one' : 'notify.hot.body_other', {
                count,
                world: worldName
              })
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
  const retained = new Map<NativeNotification, ReturnType<typeof setTimeout> | null>()

  const release = (notification: NativeNotification): void => {
    const timer = retained.get(notification)
    if (timer !== undefined && timer !== null) clearTimeout(timer)
    retained.delete(notification)
  }

  return (alert): void => {
    if (!NativeNotification.isSupported()) return

    try {
      const { title, body } = notificationPresenter(alert)
      const notification = new NativeNotification({ title, body, icon })
      const hot = alert.type === 'hot-instance'
      notification.on('click', hot ? () => focusDashboard(alert.platform) : focusMainWindow)
      const cleanup = (): void => release(notification)
      notification.on('close', (details) => {
        // A hot alert that timed out still sits in the notification centre, and
        // only its own click handler opens Hot Instances (the generic
        // activation handler just focuses the window), so keep it alive. The
        // 20-entry cap still bounds what is kept.
        if (hot && details?.reason === 'timedOut') return
        cleanup()
      })
      notification.once('failed', () => {
        logFailure()
        cleanup()
      })
      let cleanupTimer: ReturnType<typeof setTimeout> | null = null
      if (!hot) {
        cleanupTimer = setTimeout(cleanup, FRIEND_NOTIFICATION_RETENTION_MS)
        cleanupTimer.unref()
      }
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

/** Read the current snapshot at dispatch. The Dashboard's Hot Instances switch
 *  only hides that Dashboard section, so it no longer gates the alert. */
export function isFriendAlertEnabled(type: FriendAlertType, settings: Settings): boolean {
  switch (type) {
    case 'online':
      return settings.notifyFriendOnline
    case 'in-game':
      return settings.notifyFriendInGame
    case 'offline':
      return settings.notifyFriendOffline
    case 'hot-instance':
      return settings.notifyHotInstance
  }
}
