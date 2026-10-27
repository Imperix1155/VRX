import type { InboxItem } from '@shared/inbox'
import type { Platform } from '@shared/types'
import type { PlatformFilter } from '../stores/friends'

/** Rows in the platform filter's scope, newest first (main already sorts). */
export function scopeInboxItems(items: readonly InboxItem[], filter: PlatformFilter): InboxItem[] {
  return filter === 'all' ? [...items] : items.filter((item) => item.platform === filter)
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
