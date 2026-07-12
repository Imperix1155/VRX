import type { AdapterEvent, Friend, Platform } from '@shared/types'

type LogLevel = 'debug' | 'warn'
type AuthorityLog = (level: LogLevel, message: string, meta: Record<string, unknown>) => void

interface VersionedFriend {
  friend: Friend | null
  /** Id-only live state received before the REST profile seed. */
  pending?: Pick<Friend, 'presence' | 'instance'>
  revision: number
  updatedAt: number
}

interface PlatformState {
  friends: Map<string, VersionedFriend>
  seeded: boolean
  stale: boolean
  minimumSeedRevision: number
}

export type LocationResolution =
  { ok: true; friend: Friend } | { ok: false; reason: 'unknown-friend' | 'stale' }

export interface LocationAuthorityOptions {
  clock?: () => number
  log?: AuthorityLog
}

/** Main-owned, revision-fenced authority for friend location data. */
export class LocationAuthority {
  private revision = 0
  private readonly clock: () => number
  private readonly log: AuthorityLog
  private readonly states: Record<Platform, PlatformState> = {
    vrchat: { friends: new Map(), seeded: false, stale: true, minimumSeedRevision: 0 },
    chilloutvr: { friends: new Map(), seeded: false, stale: true, minimumSeedRevision: 0 }
  }

  constructor(options: LocationAuthorityOptions = {}) {
    this.clock = options.clock ?? Date.now
    this.log = options.log ?? (() => undefined)
  }

  /** Capture before starting getFriends so later deltas can fence its response. */
  captureSeedRevision(platform: Platform): number {
    void platform
    return ++this.revision
  }

  seed(platform: Platform, friends: Friend[], capturedRevision: number): void {
    const state = this.states[platform]
    if (capturedRevision < state.minimumSeedRevision) return
    const incoming = new Set(friends.map((friend) => friend.platformUserId))
    const updatedAt = this.clock()

    for (const friend of friends) {
      const current = state.friends.get(friend.platformUserId)
      if (current === undefined || current.revision <= capturedRevision) {
        state.friends.set(friend.platformUserId, { friend, revision: capturedRevision, updatedAt })
      } else if (current.friend === null && current.pending !== undefined) {
        state.friends.set(friend.platformUserId, {
          ...current,
          friend: { ...friend, ...current.pending } as Friend,
          pending: undefined
        })
      }
    }
    for (const [id, current] of state.friends) {
      if (!incoming.has(id) && current.revision <= capturedRevision) {
        state.friends.set(id, { friend: null, revision: capturedRevision, updatedAt })
      }
    }
    state.seeded = true
  }

  /** Synchronous by design: call before alert/broadcast fan-out. */
  consume(event: AdapterEvent): void {
    const state = this.states[event.platform]
    if (event.type === 'connection') {
      state.stale = event.health !== 'live'
      return
    }
    if (event.type === 'auth-invalidated') {
      state.stale = true
      return
    }

    const revision = ++this.revision
    const updatedAt = this.clock()
    const store = (
      id: string,
      friend: Friend | null,
      pending?: Pick<Friend, 'presence' | 'instance'>
    ): void => {
      state.friends.set(id, { friend, pending, revision, updatedAt })
    }
    const markOffline = (id: string): void => {
      const current = state.friends.get(id)?.friend
      const offline = { presence: { state: 'offline' as const }, instance: null }
      store(
        id,
        current === null || current === undefined ? null : { ...current, ...offline },
        offline
      )
    }

    switch (event.type) {
      case 'friend-presence':
      case 'friend-added':
        store(event.friend.platformUserId, event.friend)
        break
      case 'friend-offline':
        markOffline(event.platformUserId)
        break
      case 'friend-removed':
        store(event.platformUserId, null)
        break
      case 'friend-updated':
        // Profile-only event: preserve the authority's location and presence.
        break
      case 'friends-snapshot': {
        const ids = new Set(event.friends.map((friend) => friend.platformUserId))
        for (const friend of event.friends) store(friend.platformUserId, friend)
        if (event.scope === 'all') {
          for (const id of state.friends.keys()) if (!ids.has(id)) store(id, null)
        }
        break
      }
      case 'presence-snapshot': {
        const ids = new Set(event.entries.map((entry) => entry.platformUserId))
        for (const [id, current] of state.friends) {
          if (!ids.has(id) && current.friend !== null) markOffline(id)
        }
        for (const entry of event.entries) {
          const current = state.friends.get(entry.platformUserId)?.friend
          if (current !== null && current !== undefined) {
            store(entry.platformUserId, {
              ...current,
              presence: entry.presence,
              instance: entry.instance
            } as Friend)
          } else {
            store(entry.platformUserId, null, {
              presence: entry.presence,
              instance: entry.instance
            })
          }
        }
        break
      }
      case 'roster-changed':
        break
    }
  }

  resolve(platform: Platform, friendId: string): LocationResolution {
    const state = this.states[platform]
    if (!state.seeded || state.stale) return { ok: false, reason: 'stale' }
    const friend = state.friends.get(friendId)?.friend
    return friend ? { ok: true, friend } : { ok: false, reason: 'unknown-friend' }
  }

  clearPlatform(platform: Platform): void {
    const state = this.states[platform]
    state.friends.clear()
    state.seeded = false
    state.stale = true
    state.minimumSeedRevision = ++this.revision
    this.log('debug', 'location authority cleared', { platform, at: this.clock() })
  }
}
