/**
 * The inbox: invites, invite requests and friend requests the two sockets
 * delivered while VRX was open.
 *
 * View-only and memory-only. Nothing here talks to a platform: dismissing or
 * clearing hides a row in VRX and never answers, declines or marks anything on
 * the user's account. Rows are bounded per platform, deduped by sender, and
 * cleared at every account boundary. Dismissed record IDs are remembered (also
 * bounded) so a socket replay after a reconnect stays hidden.
 *
 * Alerts read their switch at dispatch, default off, and are rate limited per
 * platform and per sender. Nothing logged here carries a name or world.
 */
import {
  MAX_INBOX_DISMISSED_PER_PLATFORM,
  MAX_INBOX_ITEMS_PER_PLATFORM,
  type InboxEntry,
  type InboxItem,
  type InboxKind,
  type InboxSnapshot
} from '@shared/inbox'
import type { AdapterEvent, Platform } from '@shared/types'

/** Alerts per platform in one window, and the window. */
export const INBOX_ALERT_LIMIT = 3
export const INBOX_ALERT_WINDOW_MS = 60_000

export interface InboxServiceOptions {
  /** Wall clock (ms since epoch) for the time shown on each row. */
  now: () => number
  /** Monotonic clock for alert limits. */
  clock: () => number
  /** Rows changed; main tells the renderer to read again. */
  onChanged: () => void
  notify: (item: InboxItem) => void
  isAlertEnabled: (kind: InboxKind) => boolean
}

interface StoredItem {
  item: InboxItem
  sourceId: string
}

interface PlatformInbox {
  /** Insertion order is arrival order, so the first key is the oldest row. */
  items: Map<string, StoredItem>
  /** Insertion-ordered set of dismissed item IDs, oldest first. */
  dismissed: Set<string>
  recentAlerts: Array<{ at: number; key: string }>
}

const itemIdOf = (entry: Pick<InboxEntry, 'kind' | 'sourceId'>): string =>
  `${entry.kind}:${entry.sourceId}`

function emptyInbox(): PlatformInbox {
  return { items: new Map(), dismissed: new Set(), recentAlerts: [] }
}

export class InboxService {
  private readonly platforms: Record<Platform, PlatformInbox> = {
    vrchat: emptyInbox(),
    chilloutvr: emptyInbox()
  }

  constructor(private readonly options: InboxServiceOptions) {}

  /** Adapter events in: inbox changes, plus a new friend settling their request. */
  consume(event: AdapterEvent): void {
    if (event.type === 'friend-added') {
      this.settleFriendRequest(event.platform, event.friend.platformUserId)
      return
    }
    if (event.type !== 'inbox') return
    const { change, platform } = event
    switch (change.op) {
      case 'add':
        this.add(platform, change.entries)
        return
      case 'remove':
        this.removeSources(platform, change.sourceIds)
        return
      case 'clear':
        if (this.platforms[platform].items.size === 0) return
        this.platforms[platform].items.clear()
        this.options.onChanged()
        return
    }
  }

  snapshot(): InboxSnapshot {
    const items = [
      ...this.platforms.vrchat.items.values(),
      ...this.platforms.chilloutvr.items.values()
    ].map(({ item }) => ({ ...item }))
    items.sort((a, b) => b.receivedAt - a.receivedAt)
    return { items }
  }

  /** A roster read: anyone on it is a friend now, so their request is settled.
   *  This is how ChilloutVR requests clear, since its socket names no one. */
  settleRoster(platform: Platform, friends: ReadonlyArray<{ platformUserId: string }>): void {
    const inbox = this.platforms[platform]
    if (inbox.items.size === 0) return
    const friendIds = new Set(friends.map((friend) => friend.platformUserId))
    let changed = false
    for (const [id, stored] of inbox.items) {
      if (stored.item.kind === 'friend-request' && friendIds.has(stored.item.senderId)) {
        inbox.items.delete(id)
        changed = true
      }
    }
    if (changed) this.options.onChanged()
  }

  /** Hide one row in VRX. False when it is already gone. */
  dismiss(platform: Platform, id: string): boolean {
    const inbox = this.platforms[platform]
    if (!inbox.items.delete(id)) return false
    this.remember(inbox, id)
    this.options.onChanged()
    return true
  }

  /** Hide every row for these platforms. */
  clear(platforms: readonly Platform[]): void {
    let changed = false
    for (const platform of new Set(platforms)) {
      const inbox = this.platforms[platform]
      for (const id of inbox.items.keys()) this.remember(inbox, id)
      if (inbox.items.size > 0) changed = true
      inbox.items.clear()
    }
    if (changed) this.options.onChanged()
  }

  /** Account boundary: nothing from the old account may stay. */
  resetPlatform(platform: Platform): void {
    const hadItems = this.platforms[platform].items.size > 0
    this.platforms[platform] = emptyInbox()
    if (hadItems) this.options.onChanged()
  }

  private add(platform: Platform, entries: readonly InboxEntry[]): void {
    const inbox = this.platforms[platform]
    const fresh: InboxItem[] = []
    let changed = false
    for (const entry of entries) {
      const id = itemIdOf(entry)
      if (inbox.dismissed.has(id)) continue
      const existing = inbox.items.get(id)
      if (existing) {
        // A replay of a known record: refresh names, keep its time and place.
        const { item } = existing
        if (item.senderName !== entry.senderName || item.worldName !== entry.worldName) {
          existing.item = { ...item, senderName: entry.senderName, worldName: entry.worldName }
          changed = true
        }
        continue
      }
      // One row per sender and kind: a newer invite replaces the older one,
      // which stays hidden if a replay brings it back.
      for (const [otherId, other] of inbox.items) {
        if (other.item.kind === entry.kind && other.item.senderId === entry.senderId) {
          inbox.items.delete(otherId)
          this.remember(inbox, otherId)
        }
      }
      const item: InboxItem = {
        id,
        platform,
        kind: entry.kind,
        senderId: entry.senderId,
        senderName: entry.senderName,
        worldName: entry.worldName,
        receivedAt: this.options.now()
      }
      inbox.items.set(id, { item, sourceId: entry.sourceId })
      fresh.push(item)
      changed = true
      while (inbox.items.size > MAX_INBOX_ITEMS_PER_PLATFORM) {
        const oldest = inbox.items.keys().next().value
        if (oldest === undefined) break
        inbox.items.delete(oldest)
      }
    }
    if (changed) this.options.onChanged()
    for (const item of fresh) {
      if (inbox.items.has(item.id)) this.alert(inbox, item)
    }
  }

  private removeSources(platform: Platform, sourceIds: readonly string[]): void {
    const inbox = this.platforms[platform]
    const targets = new Set(sourceIds)
    let changed = false
    for (const [id, stored] of inbox.items) {
      if (targets.has(stored.sourceId)) {
        inbox.items.delete(id)
        changed = true
      }
    }
    if (changed) this.options.onChanged()
  }

  private settleFriendRequest(platform: Platform, senderId: string): void {
    const inbox = this.platforms[platform]
    let changed = false
    for (const [id, stored] of inbox.items) {
      if (stored.item.kind === 'friend-request' && stored.item.senderId === senderId) {
        inbox.items.delete(id)
        changed = true
      }
    }
    if (changed) this.options.onChanged()
  }

  private remember(inbox: PlatformInbox, id: string): void {
    inbox.dismissed.delete(id)
    inbox.dismissed.add(id)
    while (inbox.dismissed.size > MAX_INBOX_DISMISSED_PER_PLATFORM) {
      const oldest = inbox.dismissed.values().next().value
      if (oldest === undefined) break
      inbox.dismissed.delete(oldest)
    }
  }

  private alert(inbox: PlatformInbox, item: InboxItem): void {
    let enabled: boolean
    try {
      enabled = this.options.isAlertEnabled(item.kind)
    } catch {
      enabled = false
    }
    if (!enabled) return
    const now = this.options.clock()
    const cutoff = now - INBOX_ALERT_WINDOW_MS
    inbox.recentAlerts = inbox.recentAlerts.filter((entry) => entry.at > cutoff && entry.at <= now)
    const key = `${item.kind}:${item.senderId}`
    if (inbox.recentAlerts.length >= INBOX_ALERT_LIMIT) return
    if (inbox.recentAlerts.some((entry) => entry.key === key)) return
    inbox.recentAlerts.push({ at: now, key })
    try {
      this.options.notify({ ...item })
    } catch {
      // A failing notifier never blocks the inbox; the notifier logs itself.
    }
  }
}
