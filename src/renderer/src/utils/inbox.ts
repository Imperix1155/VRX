import type { InboxItem } from '@shared/inbox'
import type { Platform } from '@shared/types'
import type { PlatformFilter } from '../stores/friends'

/** The row's second line: what the sender did, in the UI language. */
export function inboxActionText(
  item: InboxItem,
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
  switch (item.kind) {
    case 'invite':
      return item.worldName === null
        ? t('inbox.inviteNoWorld')
        : t('inbox.invite', { world: item.worldName })
    case 'invite-request':
      return t('inbox.inviteRequest')
    case 'friend-request':
      return t('inbox.friendRequest')
  }
}

/** Rows in the platform filter's scope, newest first (main already sorts). */
export function scopeInboxItems(items: readonly InboxItem[], filter: PlatformFilter): InboxItem[] {
  return filter === 'all' ? [...items] : items.filter((item) => item.platform === filter)
}

const INVITE_PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/**
 * The Dashboard's latest invites: the newest invite or invite request per
 * platform in scope (VRChat's row first), and how many there are in all.
 */
export function latestInvitePerPlatform(
  items: readonly InboxItem[],
  platforms: readonly Platform[]
): { latest: InboxItem[]; total: number } {
  const invites = items.filter(
    (item) => item.kind !== 'friend-request' && platforms.includes(item.platform)
  )
  const latest = INVITE_PLATFORMS.flatMap((platform) => {
    const newest = invites
      .filter((item) => item.platform === platform)
      .reduce<InboxItem | undefined>(
        (best, item) => (best === undefined || item.receivedAt > best.receivedAt ? item : best),
        undefined
      )
    return newest ? [newest] : []
  })
  return { latest, total: invites.length }
}

/** Rows that arrived after the newest one the user has had on screen, per platform. */
export function countNewInboxItems(
  items: readonly InboxItem[],
  seenAt: Readonly<Record<Platform, number>>
): number {
  return items.reduce(
    (count, item) => (item.receivedAt > seenAt[item.platform] ? count + 1 : count),
    0
  )
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "5 minutes ago" in the UI language. Under a minute is the caller's
 * "Just now" (null here). A clock that moved backwards also reads as now.
 */
export function relativeInboxTime(receivedAt: number, now: number, locale: string): string | null {
  const elapsed = now - receivedAt
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return null
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'long' })
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), 'hour')
  return format.format(-Math.floor(elapsed / DAY), 'day')
}
