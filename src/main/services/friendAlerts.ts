import type { AdapterEvent, Friend, InstanceInfo, Platform, PresenceState } from '@shared/types'

export type FriendAlertType = 'online' | 'in-game' | 'offline'

export interface FriendAlert {
  type: FriendAlertType
  platform: Platform
  platformUserId: string
  displayName: string
  worldName: string | null
}

interface KnownPresence {
  state: PresenceState
  instanceId: string | null
  worldId: string | null
  worldName: string | null
}

interface FriendAlertsOptions {
  notify: (alert: FriendAlert) => void
  clock: () => number
  isEnabled: (type: FriendAlertType) => boolean
  resolveName: (platform: Platform, platformUserId: string) => string | null
}

const RATE_LIMIT_COUNT = 3
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMITED_TYPES: ReadonlySet<FriendAlertType> = new Set(['online', 'in-game', 'offline'])
const MAX_PRESENCE_ENTRIES_PER_PLATFORM = 2_048

/**
 * Pure friend-presence transition engine (VRX-84). It consumes the same
 * normalized AdapterEvent stream as the renderer, owns only an in-memory
 * baseline, and delegates both settings and side effects through injections.
 */
export class FriendAlerts {
  private readonly presence = new Map<Platform, Map<string, KnownPresence>>()
  private readonly names = new Map<Platform, Map<string, string>>()
  private readonly snapshotBaselined = new Map<Platform, boolean>()
  private readonly emittedAt: Record<FriendAlertType, number[]> = {
    online: [],
    'in-game': [],
    offline: []
  }
  private readonly dropped: Record<FriendAlertType, number> = {
    online: 0,
    'in-game': 0,
    offline: 0
  }

  constructor(private readonly options: FriendAlertsOptions) {}

  consume(event: AdapterEvent): void {
    switch (event.type) {
      case 'connection':
        if (event.health === 'live') this.resetPlatform(event.platform)
        return
      case 'friend-presence':
        this.rememberName(event.friend)
        this.applyPresence(
          event.platform,
          event.friend.platformUserId,
          this.fromFriend(event.friend),
          true
        )
        return
      case 'friend-offline':
        this.applyPresence(
          event.platform,
          event.platformUserId,
          { state: 'offline', instanceId: null, worldId: null, worldName: null },
          true
        )
        return
      case 'friend-updated':
        this.rememberName(event.friend)
        return
      case 'friend-added':
        this.rememberName(event.friend)
        this.applyPresence(
          event.platform,
          event.friend.platformUserId,
          this.fromFriend(event.friend),
          true
        )
        return
      case 'friend-removed':
        this.platformPresence(event.platform).delete(event.platformUserId)
        this.platformNames(event.platform).delete(event.platformUserId)
        return
      case 'friends-snapshot':
        for (const friend of event.friends) this.rememberName(friend)
        return
      case 'presence-snapshot':
        this.consumePresenceSnapshot(event)
        return
      case 'roster-changed':
        // Trigger-only. Snapshot diffing baselines every never-seen id, while an
        // already-known online id that becomes absent still produces the accepted
        // offline transition (the offline alert setting is default-off).
        return
      case 'auth-invalidated':
        this.resetPlatform(event.platform)
        return
    }
  }

  getDroppedCount(type?: FriendAlertType): number {
    return type === undefined
      ? this.dropped.online + this.dropped['in-game'] + this.dropped.offline
      : this.dropped[type]
  }

  /** Clear all alert state at an authentication/account boundary. */
  resetPlatform(platform: Platform): void {
    this.platformPresence(platform).clear()
    this.platformNames(platform).clear()
    this.snapshotBaselined.set(platform, false)
  }

  private consumePresenceSnapshot(
    event: Extract<AdapterEvent, { type: 'presence-snapshot' }>
  ): void {
    const current = this.platformPresence(event.platform)
    const firstSnapshot = this.snapshotBaselined.get(event.platform) !== true

    if (firstSnapshot) {
      current.clear()
      for (const entry of event.entries) {
        this.setPresence(
          event.platform,
          entry.platformUserId,
          this.fromPresence(event.platform, entry.presence.state, entry.instance)
        )
      }
      this.snapshotBaselined.set(event.platform, true)
      return
    }

    const incoming = new Map(event.entries.map((entry) => [entry.platformUserId, entry]))

    // A CVR snapshot is the complete current online set. Any previously known
    // online friend omitted from it made a real transition to offline.
    for (const [platformUserId, previous] of current) {
      if (!incoming.has(platformUserId) && previous.state !== 'offline') {
        this.applyPresence(
          event.platform,
          platformUserId,
          { state: 'offline', instanceId: null, worldId: null, worldName: null },
          false
        )
      }
    }

    for (const entry of event.entries) {
      this.applyPresence(
        event.platform,
        entry.platformUserId,
        this.fromPresence(event.platform, entry.presence.state, entry.instance),
        true
      )
    }
  }

  private applyPresence(
    platform: Platform,
    platformUserId: string,
    next: KnownPresence,
    baselineOnFirstSight: boolean
  ): void {
    const platformPresence = this.platformPresence(platform)
    const previous = platformPresence.get(platformUserId)
    this.setPresence(platform, platformUserId, next)

    if (previous === undefined) {
      if (baselineOnFirstSight) return
    }

    const before = previous ?? {
      state: 'offline',
      instanceId: null,
      worldId: null,
      worldName: null
    }
    const wasOnline = before.state === 'active' || before.state === 'in-game'
    const isOnline = next.state === 'active' || next.state === 'in-game'

    if (!wasOnline && isOnline) {
      this.fire('online', platform, platformUserId, next.worldName)
    }

    const enteredDifferentInstance =
      next.state === 'in-game' &&
      next.instanceId !== null &&
      (before.state !== 'in-game' ||
        before.instanceId === null ||
        !this.isSameInstance(platform, before, next))
    if (enteredDifferentInstance) {
      this.fire('in-game', platform, platformUserId, next.worldName)
    }

    if (wasOnline && next.state === 'offline') {
      this.fire('offline', platform, platformUserId, null)
    }
  }

  private fire(
    type: FriendAlertType,
    platform: Platform,
    platformUserId: string,
    worldName: string | null
  ): void {
    // Read at the exact decision point so a just-saved setting applies to the
    // very next event; the engine never caches toggle values.
    if (!this.options.isEnabled(type)) return

    const displayName =
      this.platformNames(platform).get(platformUserId) ??
      this.options.resolveName(platform, platformUserId)
    // Never fall back to an opaque platform id in a user-facing notification.
    // The CVR adapter warms its roster on first live connection to narrow this
    // window; a transition that still arrives before a readable name is known is
    // intentionally not replayed later because presence has already advanced.
    if (displayName == null || displayName.trim() === '') return

    if (!this.withinRateLimit(type)) return
    this.options.notify({ type, platform, platformUserId, displayName, worldName })
  }

  private withinRateLimit(type: FriendAlertType): boolean {
    if (!RATE_LIMITED_TYPES.has(type)) return true

    const limitedType = type
    const now = this.options.clock()
    const cutoff = now - RATE_LIMIT_WINDOW_MS
    const recent = this.emittedAt[limitedType].filter((timestamp) => timestamp > cutoff)
    this.emittedAt[limitedType] = recent
    if (recent.length >= RATE_LIMIT_COUNT) {
      this.dropped[limitedType] += 1
      return false
    }
    recent.push(now)
    return true
  }

  private rememberName(friend: Friend): void {
    const platformNames = this.platformNames(friend.platform)
    if (!platformNames.has(friend.platformUserId)) {
      while (platformNames.size >= MAX_PRESENCE_ENTRIES_PER_PLATFORM) {
        const oldest = platformNames.keys().next().value
        if (oldest === undefined) break
        platformNames.delete(oldest)
      }
    }
    platformNames.set(friend.platformUserId, friend.displayName)
  }

  private setPresence(platform: Platform, platformUserId: string, presence: KnownPresence): void {
    const platformPresence = this.platformPresence(platform)
    // Prefer evicting tombstones; with silent first-sight baselining a re-seen
    // evicted id baselines quietly (never a synthetic alert), so when every
    // entry is live the oldest live entry goes — the map stays hard-bounded
    // even against a hostile/buggy event stream (worst case: a MISSED alert at
    // >cap roster scale, never a false one).
    if (
      !platformPresence.has(platformUserId) &&
      platformPresence.size >= MAX_PRESENCE_ENTRIES_PER_PLATFORM
    ) {
      let evictId: string | undefined
      for (const [knownId, known] of platformPresence) {
        if (known.state === 'offline') {
          evictId = knownId
          break
        }
      }
      evictId ??= platformPresence.keys().next().value
      if (evictId !== undefined) {
        platformPresence.delete(evictId)
        // A name is account/presence state too; evict the pair together.
        this.platformNames(platform).delete(evictId)
      }
    }
    platformPresence.set(platformUserId, presence)
  }

  private fromFriend(friend: Friend): KnownPresence {
    return this.fromPresence(friend.platform, friend.presence.state, friend.instance)
  }

  private fromPresence(
    platform: Platform,
    state: PresenceState,
    instance: InstanceInfo | null
  ): KnownPresence {
    return {
      state,
      // instanceId is stable while CVR enriches the same snapshot's worldId and
      // worldName asynchronously, preventing metadata re-emits from looking
      // like a move. A state change into a hidden/worldless instance still has
      // null here and is detected by the state comparison above.
      instanceId: instance?.instanceId ?? null,
      worldId: instance?.worldId ?? null,
      // CVR's unresolved worldId fallback equals its instanceId, so its wire
      // worldName is still creator-set instance copy. The adapter normally
      // removes it; this keeps the alert engine safe if called directly too.
      worldName:
        platform === 'chilloutvr' && instance !== null && instance.worldId === instance.instanceId
          ? null
          : (instance?.worldName ?? null)
    }
  }

  private isSameInstance(
    platform: Platform,
    previous: KnownPresence,
    next: KnownPresence
  ): boolean {
    if (previous.instanceId !== next.instanceId) return false
    if (previous.worldId === next.worldId) return true

    // CVR initially uses the globally unique instance id as a world-id
    // fallback, then asynchronously enriches that same instance with its real
    // world id. That metadata-only correction is not a movement transition.
    return (
      platform === 'chilloutvr' &&
      previous.instanceId !== null &&
      (previous.worldId === previous.instanceId || next.worldId === next.instanceId)
    )
  }

  private platformPresence(platform: Platform): Map<string, KnownPresence> {
    let known = this.presence.get(platform)
    if (known === undefined) {
      known = new Map()
      this.presence.set(platform, known)
    }
    return known
  }

  private platformNames(platform: Platform): Map<string, string> {
    let known = this.names.get(platform)
    if (known === undefined) {
      known = new Map()
      this.names.set(platform, known)
    }
    return known
  }
}
