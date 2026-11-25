import type { AdapterEvent, Friend, InstanceInfo, Platform } from '@shared/types'
import {
  activityKindsOf,
  activitySearchText,
  matchesActivityFilter,
  matchesActivityListQuery,
  type ActivityEntry,
  type ActivityFilter,
  type ActivityKind,
  type ActivityPage,
  type ActivityPageRequest,
  type FriendListKind
} from '@shared/activity'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM, ACTIVITY_PAGE_SIZE } from '@shared/constants'
import { isWorldHidden } from '@shared/hotInstanceKey'
import { FriendAlerts, type FriendAlert } from './friendAlerts'

/** Where an entry happened. Kept in main only, so a world name that resolves a
 *  moment after the move can still fill the entry in. Never kept for a hidden
 *  location. */
interface EntryLocation {
  worldId: string
  instanceId: string
}

interface StoredEntry extends ActivityEntry {
  location: EntryLocation | null
}

interface EventLocation {
  hidden: boolean
  location: EntryLocation | null
}

/**
 * Where entries are saved between runs (`activityHistory.ts`). Every call is
 * about the account signed in right now on that platform; the store resolves
 * it. A store that is not saving ignores writes and answers `null` for pages.
 */
export interface ActivityStore {
  /** The largest id ever saved, so new ids keep increasing across restarts. */
  maxId(): number
  append(entry: ActivityEntry): void
  setWorldName(id: number, worldName: string): void
  /** The signed-in account's newest saved entries, newest first. */
  recent(platform: Platform, limit: number): ActivityEntry[]
  /** Saved entries in a scope, newest first, or null when nothing is saved. */
  page(request: ActivityPageRequest, limit: number): ActivityEntry[] | null
  clear(platform: Platform, kinds: readonly ActivityKind[] | null): void
  clearAll(): void
}

export interface ActivityFeedOptions {
  /** Wall clock for the time shown on each entry. */
  now: () => number
  /** Monotonic clock for the transition engine. */
  clock: () => number
  /** Read at each transition: whether the user has the activity list on. */
  isEnabled: () => boolean
  resolveName: (platform: Platform, platformUserId: string) => string | null
  /** Entries were added, filled in, or cleared. */
  onChanged: () => void
  /** The saved copy. Without one the list is memory only. */
  store?: ActivityStore
}

/** A world name arriving later than this no longer changes an old entry. */
const BACKFILL_WINDOW_MS = 10 * 60_000

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/**
 * The in-app activity list. It runs its own copy of the friend alert
 * transition engine over the same adapter events, so "came online", "joined a
 * world", and "went offline" mean exactly what the alerts mean, without the
 * alerts' toast rate limit. It makes no requests. The newest entries per
 * platform stay in memory for the page; with a store, each one is also saved
 * under its account, so an account's list comes back when it signs in again
 * (`hydrate`) and older entries can be read a page at a time (`page`). An
 * account boundary drops the outgoing account's entries from memory.
 *
 * Privacy matches the alerts: a friend set to Ask Me or Do Not Disturb never
 * has a world recorded, and their moves between worlds are not recorded.
 */
export class ActivityFeed {
  private readonly engine: FriendAlerts
  private readonly entries = new Map<Platform, StoredEntry[]>(
    PLATFORMS.map((platform) => [platform, []])
  )
  private nextId = 1
  private current: AdapterEvent | null = null
  /** Friends who came online during the current event. */
  private readonly cameOnline = new Set<string>()
  private changed = false

  constructor(private readonly options: ActivityFeedOptions) {
    this.nextId = (options.store?.maxId() ?? 0) + 1
    this.engine = new FriendAlerts({
      notify: (alert) => this.record(alert),
      clock: options.clock,
      isEnabled: (type) => type !== 'hot-instance',
      resolveName: options.resolveName,
      rateLimited: false
    })
  }

  consume(event: AdapterEvent): void {
    this.current = event
    this.cameOnline.clear()
    try {
      this.engine.consume(event)
      this.fillWorldNames(event)
    } finally {
      this.current = null
      this.cameOnline.clear()
    }
    this.flush()
  }

  /** Learn roster friends silently, as the alerts do. */
  seedRoster(platform: Platform, friends: readonly Friend[]): void {
    this.engine.seedRoster(platform, friends)
  }

  /** Newest first, both platforms. */
  list(): ActivityEntry[] {
    const all: ActivityEntry[] = []
    for (const platformEntries of this.entries.values()) {
      for (const entry of platformEntries) all.push(toPublicEntry(entry))
    }
    return all.sort((a, b) => b.id - a.id)
  }

  /**
   * An account is signed in on this platform: bring its saved entries back
   * into the list. Entries already in memory stay; nothing is saved twice.
   */
  hydrate(platform: Platform): void {
    if (this.refill(platform)) {
      this.changed = true
      this.flush()
    }
  }

  /** Top memory back up from the saved copy. While entries are saved, a
   *  platform with fewer than its allowance in memory then holds every entry
   *  saved for the account, which is how the page knows nothing older exists. */
  private refill(platform: Platform): boolean {
    const saved = this.options.store?.recent(platform, ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    if (saved === undefined || saved.length === 0) return false
    const platformEntries = this.platformEntries(platform)
    const known = new Set(platformEntries.map((entry) => entry.id))
    const added: StoredEntry[] = []
    for (const entry of saved) {
      if (entry.platform !== platform || known.has(entry.id)) continue
      known.add(entry.id)
      added.push({ ...entry, location: null })
    }
    if (added.length === 0) return false
    const merged = [...platformEntries, ...added].sort((a, b) => a.id - b.id)
    platformEntries.splice(
      0,
      platformEntries.length,
      ...merged.slice(Math.max(0, merged.length - ACTIVITY_MAX_ENTRIES_PER_PLATFORM))
    )
    return true
  }

  /**
   * Older entries than the list holds, or one friend's entries: newest first,
   * one page at a time. Read from the saved copy when there is one, else from
   * memory. Like every read here, it asks no platform for anything.
   */
  page(request: ActivityPageRequest): ActivityPage {
    const found =
      this.options.store?.page(request, ACTIVITY_PAGE_SIZE + 1) ?? this.pageFromMemory(request)
    return {
      entries: found.slice(0, ACTIVITY_PAGE_SIZE),
      hasMore: found.length > ACTIVITY_PAGE_SIZE
    }
  }

  /** Saving was just turned on: save what the list holds now. */
  saveAll(): void {
    const store = this.options.store
    if (store === undefined) return
    for (const platformEntries of this.entries.values()) {
      for (const entry of platformEntries) store.append(toPublicEntry(entry))
    }
  }

  /**
   * A session boundary. The transition baseline always resets; entries leave
   * memory unless the same account is still signed in. Saved entries stay
   * under their account.
   */
  resetPlatform(platform: Platform, { keepEntries = false }: { keepEntries?: boolean } = {}): void {
    this.engine.resetPlatform(platform)
    if (keepEntries) return
    const platformEntries = this.platformEntries(platform)
    if (platformEntries.length === 0) return
    platformEntries.length = 0
    this.changed = true
    this.flush()
  }

  /** The page's Clear: forget what it shows, these platforms' entries of the
   *  shown kind. History the page hides (the other platform, other kinds)
   *  stays. */
  clear(platforms: readonly Platform[], filter: ActivityFilter): void {
    let any = false
    const kinds = activityKindsOf(filter)
    for (const platform of new Set(platforms)) {
      // The saved copy can hold older entries than memory does.
      this.options.store?.clear(platform, kinds)
      const platformEntries = this.platformEntries(platform)
      const kept = platformEntries.filter((entry) => kinds !== null && !kinds.includes(entry.kind))
      if (kept.length !== platformEntries.length) {
        platformEntries.splice(0, platformEntries.length, ...kept)
        any = true
      }
      // Older saved entries of the kinds that stay move up into the list.
      if (this.refill(platform)) any = true
    }
    if (!any) return
    this.changed = true
    this.flush()
  }

  /** The user turned the list off: forget everything, saved entries of every
   *  account included. */
  clearAll(): void {
    this.options.store?.clearAll()
    let any = false
    for (const platformEntries of this.entries.values()) {
      if (platformEntries.length > 0) any = true
      platformEntries.length = 0
    }
    if (!any) return
    this.changed = true
    this.flush()
  }

  /**
   * The saved copy was replaced (a restored backup): the list starts over
   * from what is saved now for the accounts signed in. Ids already given out
   * are never given again.
   */
  reload(): void {
    this.nextId = Math.max(this.nextId, (this.options.store?.maxId() ?? 0) + 1)
    for (const platform of PLATFORMS) {
      this.platformEntries(platform).length = 0
      this.refill(platform)
    }
    this.changed = true
    this.flush()
  }

  /**
   * The friends list changed (`friendLog.ts`): a new friend, someone no longer
   * on the list, a friend's new name. Listed like any other entry.
   */
  recordFriendChange(change: {
    kind: FriendListKind
    platform: Platform
    platformUserId: string
    displayName: string
    previousName?: string
  }): void {
    if (!this.options.isEnabled()) return
    if (change.displayName.trim() === '') return
    const entry: StoredEntry = {
      id: this.nextId++,
      kind: change.kind,
      platform: change.platform,
      platformUserId: change.platformUserId,
      displayName: change.displayName,
      worldName: null,
      ...(change.kind === 'renamed' && change.previousName
        ? { previousName: change.previousName }
        : {}),
      at: this.options.now(),
      location: null
    }
    this.push(entry)
    this.changed = true
    this.flush()
  }

  /** Add one entry to memory and the saved copy, within the allowance. */
  private push(entry: StoredEntry): void {
    const platformEntries = this.platformEntries(entry.platform)
    platformEntries.push(entry)
    // The saved copy never gets the location: only what the page shows.
    this.options.store?.append(toPublicEntry(entry))
    if (platformEntries.length > ACTIVITY_MAX_ENTRIES_PER_PLATFORM) {
      platformEntries.splice(0, platformEntries.length - ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    }
  }

  private record(alert: FriendAlert): void {
    if (alert.type === 'hot-instance') return
    // Read at the decision point, like the alert switches.
    if (!this.options.isEnabled()) return
    const key = `${alert.platform}\u0000${alert.platformUserId}`
    const { hidden, location } = this.locationOf(alert.platform, alert.platformUserId)
    let kind: ActivityKind
    if (alert.type === 'in-game') {
      // A hidden friend's moves stay private, even without a world name.
      if (hidden) return
      // Coming online straight into a world is one entry that names the world.
      if (this.cameOnline.has(key)) return
      kind = 'world'
    } else if (alert.type === 'online') {
      this.cameOnline.add(key)
      kind = 'online'
    } else {
      kind = 'offline'
    }
    const keepsWorld = kind !== 'offline' && !hidden
    const entry: StoredEntry = {
      id: this.nextId++,
      kind,
      platform: alert.platform,
      platformUserId: alert.platformUserId,
      displayName: alert.displayName,
      worldName: keepsWorld ? cleanWorldName(alert.worldName) : null,
      at: this.options.now(),
      location: keepsWorld ? location : null
    }
    this.push(entry)
    this.changed = true
  }

  /** The location the current event reports for one friend. */
  private locationOf(platform: Platform, platformUserId: string): EventLocation {
    const event = this.current
    if (event === null || event.platform !== platform) return { hidden: false, location: null }
    switch (event.type) {
      case 'friend-presence':
      case 'friend-added':
        if (event.friend.platformUserId !== platformUserId) break
        return {
          hidden: isWorldHidden(event.friend),
          location: isWorldHidden(event.friend) ? null : locationOfInstance(event.friend.instance)
        }
      case 'presence-snapshot': {
        // ChilloutVR only: it has no status that hides a location.
        const entry = event.entries.find((item) => item.platformUserId === platformUserId)
        return { hidden: false, location: locationOfInstance(entry?.instance ?? null) }
      }
      default:
        break
    }
    return { hidden: false, location: null }
  }

  /** Fill recent entries whose world name was not known yet. */
  private fillWorldNames(event: AdapterEvent): void {
    const names = new Map<string, string>()
    let match: (location: EntryLocation) => string | undefined
    switch (event.type) {
      case 'world-metadata':
        match = (location) => (location.worldId === event.worldId ? event.worldName : undefined)
        break
      case 'friend-presence': {
        const instance = event.friend.instance
        if (
          isWorldHidden(event.friend) ||
          instance === null ||
          !instance.worldName ||
          instance.worldId === instance.instanceId
        )
          return
        match = (location) =>
          location.worldId === instance.worldId && location.instanceId === instance.instanceId
            ? (instance.worldName ?? undefined)
            : undefined
        break
      }
      case 'presence-snapshot':
        for (const entry of event.entries) {
          const instance = entry.instance
          // Until ChilloutVR resolves the world, its world id repeats the
          // instance id and the name is the instance's own label.
          if (instance === null || !instance.worldName || instance.worldId === instance.instanceId)
            continue
          names.set(instance.instanceId, instance.worldName)
        }
        if (names.size === 0) return
        match = (location) => names.get(location.instanceId)
        break
      default:
        return
    }
    const cutoff = this.options.now() - BACKFILL_WINDOW_MS
    const platformEntries = this.platformEntries(event.platform)
    for (let i = platformEntries.length - 1; i >= 0; i--) {
      const entry = platformEntries[i]
      if (entry === undefined) continue
      if (entry.at < cutoff) break
      if (entry.worldName !== null || entry.location === null) continue
      const name = cleanWorldName(match(entry.location) ?? null)
      if (name === null) continue
      platformEntries[i] = { ...entry, worldName: name }
      this.options.store?.setWorldName(entry.id, name)
      this.changed = true
    }
  }

  private pageFromMemory(request: ActivityPageRequest): ActivityEntry[] {
    const before = new Map<Platform, number | null>()
    for (const cursor of request.scope) {
      if (!before.has(cursor.platform)) before.set(cursor.platform, cursor.beforeId)
    }
    const isBefore = (entry: ActivityEntry): boolean => {
      const beforeId = before.get(entry.platform)
      return beforeId !== undefined && (beforeId === null || entry.id < beforeId)
    }
    const friends =
      request.friends === undefined
        ? null
        : new Set(request.friends.map((friend) => `${friend.platform}\u0000${friend.friendId}`))
    const storedNames =
      activitySearchText(request.query?.text) === null ? null : namesStoredIn(this.list())
    return this.list()
      .filter(
        (entry) =>
          isBefore(entry) &&
          matchesActivityFilter(entry.kind, request.filter) &&
          (friends === null || friends.has(`${entry.platform}\u0000${entry.platformUserId}`)) &&
          matchesActivityListQuery(
            entry,
            request.query,
            storedNames?.get(`${entry.platform}\u0000${entry.platformUserId}`)
          )
      )
      .slice(0, ACTIVITY_PAGE_SIZE + 1)
  }

  private flush(): void {
    if (!this.changed) return
    this.changed = false
    this.options.onChanged()
  }

  private platformEntries(platform: Platform): StoredEntry[] {
    let platformEntries = this.entries.get(platform)
    if (platformEntries === undefined) {
      platformEntries = []
      this.entries.set(platform, platformEntries)
    }
    return platformEntries
  }
}

/** Names saved on this friend's entries: the name at the time, and the one before a rename. */
function namesStoredIn(entries: readonly ActivityEntry[]): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const entry of entries) {
    const key = `${entry.platform}\u0000${entry.platformUserId}`
    const stored = names.get(key) ?? []
    stored.push(entry.displayName)
    if (entry.previousName !== undefined) stored.push(entry.previousName)
    names.set(key, stored)
  }
  return names
}

/** The renderer's copy: the backfill location stays in main. */
function toPublicEntry(entry: StoredEntry): ActivityEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    platform: entry.platform,
    platformUserId: entry.platformUserId,
    displayName: entry.displayName,
    worldName: entry.worldName,
    ...(entry.previousName === undefined ? {} : { previousName: entry.previousName }),
    at: entry.at
  }
}

function locationOfInstance(instance: InstanceInfo | null): EntryLocation | null {
  return instance === null ? null : { worldId: instance.worldId, instanceId: instance.instanceId }
}

/** A usable world name, or null. The renderer trims display-only suffixes. */
function cleanWorldName(worldName: string | null): string | null {
  return worldName === null || worldName.trim() === '' ? null : worldName
}
