import type { AdapterEvent, Friend, InstanceInfo, Platform, PresenceState } from '@shared/types'
import { HOT_INSTANCE_THRESHOLD } from '@shared/constants'

export type FriendAlertType = 'online' | 'in-game' | 'offline' | 'hot-instance'

export interface FriendTransitionAlert {
  type: Exclude<FriendAlertType, 'hot-instance'>
  platform: Platform
  platformUserId: string
  displayName: string
  worldName: string | null
}

export interface HotInstanceAlert {
  type: 'hot-instance'
  platform: Platform
  instanceId: string
  friendCount: number
  worldName: string | null
}

export type FriendAlert = FriendTransitionAlert | HotInstanceAlert

interface KnownPresence {
  state: PresenceState
  instanceId: string | null
  worldId: string | null
  worldName: string | null
}

interface KnownInstanceCount {
  count: number
  instanceId: string
  worldName: string | null
}

interface FriendAlertsOptions {
  notify: (alert: FriendAlert) => void
  clock: () => number
  isEnabled: (type: FriendAlertType) => boolean
  hotInstanceThreshold?: () => number
  resolveName: (platform: Platform, platformUserId: string) => string | null
}

const RATE_LIMIT_COUNT = 3
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMITED_TYPES: ReadonlySet<FriendAlertType> = new Set([
  'online',
  'in-game',
  'offline',
  'hot-instance'
])
const MAX_PRESENCE_ENTRIES_PER_PLATFORM = 2_048
const MAX_INSTANCE_ENTRIES_PER_PLATFORM = 2_048

/**
 * Pure friend-presence transition engine (VRX-84/85). It consumes the same
 * normalized AdapterEvent stream as the renderer, owns only an in-memory
 * baseline, and delegates both settings and side effects through injections.
 */
export class FriendAlerts {
  private readonly presence = new Map<Platform, Map<string, KnownPresence>>()
  private readonly names = new Map<Platform, Map<string, string>>()
  private readonly instances = new Map<Platform, Map<string, KnownInstanceCount>>()
  /** Once a live presence entry is evicted, any instance count on that platform
   *  could be incomplete. Suppress hot alerts until the next boundary reset;
   *  a missed alert at pathological roster scale is safer than a fabricated one. */
  private readonly unreliableInstanceCounts = new Set<Platform>()
  private readonly snapshotBaselined = new Map<Platform, boolean>()
  private readonly emittedAt: Record<FriendAlertType, number[]> = {
    online: [],
    'in-game': [],
    offline: [],
    'hot-instance': []
  }
  private readonly dropped: Record<FriendAlertType, number> = {
    online: 0,
    'in-game': 0,
    offline: 0,
    'hot-instance': 0
  }

  constructor(private readonly options: FriendAlertsOptions) {}

  consume(event: AdapterEvent): void {
    switch (event.type) {
      case 'connection':
        if (event.health === 'live') this.resetPlatform(event.platform)
        return
      case 'friend-presence':
        this.rememberName(event.friend)
        this.applyPresenceMutation(event.platform, (baselinedKeys) => {
          this.applyPresence(
            event.platform,
            event.friend.platformUserId,
            this.fromFriend(event.friend),
            true,
            baselinedKeys
          )
        })
        return
      case 'friend-offline':
        this.applyPresenceMutation(event.platform, (baselinedKeys) => {
          this.applyPresence(
            event.platform,
            event.platformUserId,
            { state: 'offline', instanceId: null, worldId: null, worldName: null },
            true,
            baselinedKeys
          )
        })
        return
      case 'friend-updated':
        this.rememberName(event.friend)
        return
      case 'friend-added':
        this.rememberName(event.friend)
        this.applyPresenceMutation(event.platform, (baselinedKeys) => {
          this.applyPresence(
            event.platform,
            event.friend.platformUserId,
            this.fromFriend(event.friend),
            true,
            baselinedKeys
          )
        })
        return
      case 'friend-removed':
        this.applyPresenceMutation(event.platform, () => {
          this.removePresence(event.platform, event.platformUserId)
        })
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
      ? this.dropped.online +
          this.dropped['in-game'] +
          this.dropped.offline +
          this.dropped['hot-instance']
      : this.dropped[type]
  }

  /** Clear all alert state at an authentication/account boundary. */
  resetPlatform(platform: Platform): void {
    this.platformPresence(platform).clear()
    this.platformNames(platform).clear()
    this.platformInstances(platform).clear()
    this.unreliableInstanceCounts.delete(platform)
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
      this.rebuildInstanceCounts(event.platform)
      this.snapshotBaselined.set(event.platform, true)
      return
    }

    this.applyPresenceMutation(event.platform, (baselinedKeys) => {
      const incoming = new Map(event.entries.map((entry) => [entry.platformUserId, entry]))

      // A CVR snapshot is the complete current online set. Any previously known
      // online friend omitted from it made a real transition to offline.
      for (const [platformUserId, previous] of current) {
        if (!incoming.has(platformUserId) && previous.state !== 'offline') {
          this.applyPresence(
            event.platform,
            platformUserId,
            { state: 'offline', instanceId: null, worldId: null, worldName: null },
            false,
            baselinedKeys
          )
        }
      }

      for (const entry of event.entries) {
        this.applyPresence(
          event.platform,
          entry.platformUserId,
          this.fromPresence(event.platform, entry.presence.state, entry.instance),
          true,
          baselinedKeys
        )
      }
    })
  }

  private applyPresence(
    platform: Platform,
    platformUserId: string,
    next: KnownPresence,
    baselineOnFirstSight: boolean,
    baselinedKeys: Set<string>
  ): void {
    const platformPresence = this.platformPresence(platform)
    const previous = platformPresence.get(platformUserId)
    this.setPresence(platform, platformUserId, next)

    if (previous === undefined) {
      if (baselineOnFirstSight) {
        const key = this.instanceKey(platform, next)
        if (key !== null) baselinedKeys.add(key)
        return
      }
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
      this.fireFriend('online', platform, platformUserId, next.worldName)
    }

    const enteredDifferentInstance =
      next.state === 'in-game' &&
      next.instanceId !== null &&
      (before.state !== 'in-game' ||
        before.instanceId === null ||
        !this.isSameInstance(platform, before, next))
    if (enteredDifferentInstance) {
      this.fireFriend('in-game', platform, platformUserId, next.worldName)
    }

    if (wasOnline && next.state === 'offline') {
      this.fireFriend('offline', platform, platformUserId, null)
    }
  }

  private fireFriend(
    type: FriendTransitionAlert['type'],
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

  private fireHotInstance(
    platform: Platform,
    instanceId: string,
    friendCount: number,
    worldName: string | null
  ): void {
    // Like the friend toggles, both policy reads happen at the crossing decision
    // rather than being cached in the engine.
    if (!this.options.isEnabled('hot-instance')) return
    if (!this.withinRateLimit('hot-instance')) return
    this.options.notify({
      type: 'hot-instance',
      platform,
      instanceId,
      friendCount,
      worldName
    })
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

  private setPresence(
    platform: Platform,
    platformUserId: string,
    presence: KnownPresence
  ): KnownPresence | null {
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
        const evictedPresence = platformPresence.get(evictId)
        platformPresence.delete(evictId)
        // A name is account/presence state too; evict the pair together.
        this.platformNames(platform).delete(evictId)
        platformPresence.set(platformUserId, presence)
        if (evictedPresence?.state === 'in-game') {
          this.unreliableInstanceCounts.add(platform)
        }
        return evictedPresence ?? null
      }
    }
    platformPresence.set(platformUserId, presence)
    return null
  }

  private removePresence(platform: Platform, platformUserId: string): void {
    this.platformPresence(platform).delete(platformUserId)
  }

  /** Apply one delta or one complete snapshot as a single count transaction.
   *  Only the pre/post aggregate diff can cross a threshold; intermediate
   *  per-friend ordering inside a snapshot is never observable. */
  private applyPresenceMutation(
    platform: Platform,
    mutate: (baselinedKeys: Set<string>) => void
  ): void {
    const before = this.platformInstances(platform)
    const baselinedKeys = new Set<string>()
    mutate(baselinedKeys)
    const after = this.buildInstanceCounts(platform)
    this.instances.set(platform, after)

    const threshold = this.options.hotInstanceThreshold?.() ?? HOT_INSTANCE_THRESHOLD
    if (this.unreliableInstanceCounts.has(platform)) return

    for (const [key, current] of after) {
      if (baselinedKeys.has(key)) continue
      const previousCount = before.get(key)?.count ?? 0
      if (previousCount < threshold && current.count >= threshold) {
        this.fireHotInstance(platform, current.instanceId, current.count, current.worldName)
      }
    }
  }

  private rebuildInstanceCounts(platform: Platform): void {
    this.instances.set(platform, this.buildInstanceCounts(platform))
  }

  private buildInstanceCounts(platform: Platform): Map<string, KnownInstanceCount> {
    const instances = new Map<string, KnownInstanceCount>()
    for (const presence of this.platformPresence(platform).values()) {
      const key = this.instanceKey(platform, presence)
      if (key === null) continue
      const known = instances.get(key)
      if (known === undefined) {
        if (instances.size >= MAX_INSTANCE_ENTRIES_PER_PLATFORM) {
          this.unreliableInstanceCounts.add(platform)
          continue
        }
        instances.set(key, {
          count: 1,
          instanceId: presence.instanceId!,
          worldName: presence.worldName
        })
      } else {
        known.count += 1
        if (presence.worldName !== null) known.worldName = presence.worldName
      }
    }
    return instances
  }

  private instanceKey(platform: Platform, presence: KnownPresence): string | null {
    if (presence.state !== 'in-game' || presence.instanceId === null) return null
    // VRChat's instance suffix is only unique inside a world. CVR instance ids
    // are globally unique and must remain stable while world metadata enriches.
    // NUL separator: cheap and collision-free for the API's id charsets (this
    // runs once per presence entry on EVERY event — JSON.stringify was the
    // hot spot that timed CI out at 10k events).
    return platform === 'vrchat'
      ? `${presence.worldId ?? ''}\u0000${presence.instanceId}`
      : presence.instanceId
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
      // worldName is still creator-set instance copy. The adapter PRESERVES it
      // for rendering (the UI's world-line fallback); this engine-side strip is
      // what keeps it out of alert copy.
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

  private platformInstances(platform: Platform): Map<string, KnownInstanceCount> {
    let known = this.instances.get(platform)
    if (known === undefined) {
      known = new Map()
      this.instances.set(platform, known)
    }
    return known
  }
}
