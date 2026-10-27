import type { AdapterEvent, Friend, InstanceInfo, Platform } from '@shared/types'
import type { ActivityEntry, ActivityKind } from '@shared/activity'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM } from '@shared/constants'
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
}

/** A world name arriving later than this no longer changes an old entry. */
const BACKFILL_WINDOW_MS = 10 * 60_000

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/**
 * The in-app activity list. It runs its own copy of the friend alert
 * transition engine over the same adapter events, so "came online", "joined a
 * world", and "went offline" mean exactly what the alerts mean, without the
 * alerts' toast rate limit. It makes no requests, keeps entries in memory
 * only, and forgets a platform's entries at an account boundary.
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
   * A session boundary. The transition baseline always resets; entries are
   * forgotten unless the same account is still signed in.
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

  /** The user cleared the list or turned it off. */
  clearAll(): void {
    let any = false
    for (const platformEntries of this.entries.values()) {
      if (platformEntries.length > 0) any = true
      platformEntries.length = 0
    }
    if (!any) return
    this.changed = true
    this.flush()
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
    const platformEntries = this.platformEntries(alert.platform)
    platformEntries.push({
      id: this.nextId++,
      kind,
      platform: alert.platform,
      platformUserId: alert.platformUserId,
      displayName: alert.displayName,
      worldName: keepsWorld ? cleanWorldName(alert.worldName) : null,
      at: this.options.now(),
      location: keepsWorld ? location : null
    })
    if (platformEntries.length > ACTIVITY_MAX_ENTRIES_PER_PLATFORM) {
      platformEntries.splice(0, platformEntries.length - ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    }
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
      this.changed = true
    }
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

/** The renderer's copy: the backfill location stays in main. */
function toPublicEntry(entry: StoredEntry): ActivityEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    platform: entry.platform,
    platformUserId: entry.platformUserId,
    displayName: entry.displayName,
    worldName: entry.worldName,
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
