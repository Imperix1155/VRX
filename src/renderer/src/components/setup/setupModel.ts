import type { AuthState, Platform } from '@shared/types'

/** Shared values for the welcome setup steps and frame. */

export const SETUP_PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/** Signed in, or connected but unreachable: the same states that open the
 *  shell (App.tsx), so setup never asks for credentials over a live session. */
export function isAccountReady(state: AuthState | undefined): boolean {
  return state === 'authenticated' || state === 'error'
}

type AlertKey =
  | 'notifyFriendOnline'
  | 'notifyFriendInGame'
  | 'notifyFriendOffline'
  | 'notifyHotInstance'
  | 'notifyInvites'
  | 'notifyFriendRequests'

/** Same order and copy as Settings → Notifications. `group` puts friend and
 *  inbox alerts in one card each, so the step fits without scrolling. */
export const SETUP_ALERTS: ReadonlyArray<{
  key: AlertKey
  group: 'friends' | 'inbox'
  label: string
  description: string
  aria: string
}> = [
  {
    key: 'notifyFriendOnline',
    group: 'friends',
    label: 'settings.notifications.online.label',
    description: 'settings.notifications.online.description',
    aria: 'settings.notifications.online.aria'
  },
  {
    key: 'notifyFriendInGame',
    group: 'friends',
    label: 'settings.notifications.inGame.label',
    description: 'settings.notifications.inGame.description',
    aria: 'settings.notifications.inGame.aria'
  },
  {
    key: 'notifyFriendOffline',
    group: 'friends',
    label: 'settings.notifications.offline.label',
    description: 'settings.notifications.offline.description',
    aria: 'settings.notifications.offline.aria'
  },
  {
    key: 'notifyHotInstance',
    group: 'friends',
    label: 'settings.notifications.hotInstance.label',
    description: 'settings.notifications.hotInstance.description',
    aria: 'settings.notifications.hotInstance.aria'
  },
  {
    key: 'notifyInvites',
    group: 'inbox',
    label: 'settings.notifications.invites.label',
    description: 'settings.notifications.invites.description',
    aria: 'settings.notifications.invites.aria'
  },
  {
    key: 'notifyFriendRequests',
    group: 'inbox',
    label: 'settings.notifications.friendRequests.label',
    description: 'settings.notifications.friendRequests.description',
    aria: 'settings.notifications.friendRequests.aria'
  }
]

export const SECONDARY_BUTTON =
  'rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[14px] py-[10px] text-[13px] font-semibold leading-none text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors cursor-pointer'
