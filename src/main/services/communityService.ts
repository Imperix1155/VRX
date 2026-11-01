import {
  COMMUNITY_CACHE_MS,
  COMMUNITY_SEARCH_COOLDOWN_MS,
  isCommunityUserId,
  normalizeCommunityQuery,
  type CommunityFailure,
  type CommunityGroup,
  type CommunitySearchResult,
  type CommunityWorld,
  type MyGroupsResult,
  type PersonProfile,
  type PlayersOnlineResult,
  type ProfileGroupsResult,
  type ProfileResult,
  type ProfileWorldsResult,
  type WorldList,
  type WorldListResult
} from '@shared/community'
import type { ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import type {
  CommunityAdapter,
  CommunityList,
  CommunitySearchPage
} from './adapters/CommunityAdapter'
import type { ExploreWorldEvidence } from './adapters/ExploreAdapter'
import { AuthError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

/** A Refresh press re-reads only an answer at least this old. */
export const COMMUNITY_REFRESH_MIN_MS = 30_000
/** Bounds on what one session remembers per platform. */
const MAX_PROFILES = 50
const MAX_SEARCHES = 20
const MAX_KNOWN_PEOPLE = 500

type CommunityLog = (
  message: 'community request failed',
  meta: { platform: Platform; kind: ReadKind; reason: CommunityFailure }
) => void

type ReadKind =
  | 'profile'
  | 'profile-worlds'
  | 'profile-groups'
  | 'search'
  | 'world-list'
  | 'players-online'
  | 'my-groups'

export interface CommunityServiceOptions {
  adapters: ReadonlyMap<Platform, CommunityAdapter>
  /** Explore issues the world references (`ExploreService.adoptWorlds`). */
  adoptWorlds: (platform: Platform, evidence: readonly ExploreWorldEvidence[]) => ExploreWorld[]
  /** Whether the person is on the signed-in user's friends list now. */
  isFriend: (platform: Platform, userId: string) => boolean
  clock?: () => number
  wallClock?: () => number
  log?: CommunityLog
}

interface Cached<T> {
  value: T
  at: number
}

interface PlatformState {
  lease: RequestLease
  profiles: Map<string, Cached<PersonProfile | null>>
  profileWorlds: Map<string, Cached<CommunityList<CommunityWorld>>>
  profileGroups: Map<string, Cached<CommunityList<CommunityGroup>>>
  searches: Map<string, Cached<CommunitySearchPage>>
  lists: Map<WorldList, Cached<ExploreWorldEvidence[]>>
  myGroups: Map<'mine', Cached<CommunityList<CommunityGroup>>>
  playersOnline: Map<'count', Cached<{ count: number; checkedAt: number }>>
  /** One read per key at a time; a second ask joins the first. */
  pending: Map<string, Promise<unknown>>
  /** People a search showed this session, the only non-friends a profile may name. */
  known: Set<string>
  lastSearchAt: number | null
}

/**
 * Main-owned, read-only community lookups. Nothing here runs on a timer:
 * every read follows a page opening, a press, or a typed search, and answers
 * are reused for COMMUNITY_CACHE_MS so moving between pages adds no requests.
 * Each platform's memory belongs to one session lease, so an answer never
 * crosses an account boundary. Profiles are read only for friends and for
 * people a search showed, so the renderer cannot walk arbitrary accounts.
 * Searches are spaced COMMUNITY_SEARCH_COOLDOWN_MS apart per platform.
 */
export class CommunityService {
  private readonly states = new Map<Platform, PlatformState>()
  private readonly clock: () => number
  private readonly wallClock: () => number
  private readonly log: CommunityLog

  constructor(private readonly options: CommunityServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.wallClock = options.wallClock ?? Date.now
    this.log = options.log ?? (() => undefined)
  }

  async getProfile(platform: Platform, userId: string): Promise<ProfileResult> {
    const target = this.person(platform, userId)
    if (!target.ok) return target
    const { adapter, state, id } = target
    try {
      const profile = await this.read(
        state,
        state.profiles,
        `profile:${id}`,
        id,
        MAX_PROFILES,
        false,
        () => adapter.getProfile(id, state.lease)
      )
      return profile ? { ok: true, profile } : { ok: false, reason: 'not-found' }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'profile', error) }
    }
  }

  async getProfileWorlds(platform: Platform, userId: string): Promise<ProfileWorldsResult> {
    const target = this.person(platform, userId)
    if (!target.ok) return target
    const { adapter, state, id } = target
    try {
      const list = await this.read(
        state,
        state.profileWorlds,
        `profile-worlds:${id}`,
        id,
        MAX_PROFILES,
        false,
        () => adapter.getProfileWorlds(id, state.lease)
      )
      return { ok: true, worlds: list.items, complete: list.complete }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'profile-worlds', error) }
    }
  }

  async getProfileGroups(platform: Platform, userId: string): Promise<ProfileGroupsResult> {
    const target = this.person(platform, userId)
    if (!target.ok) return target
    const { adapter, state, id } = target
    try {
      const list = await this.read(
        state,
        state.profileGroups,
        `profile-groups:${id}`,
        id,
        MAX_PROFILES,
        false,
        () => adapter.getProfileGroups(id, state.lease)
      )
      return { ok: true, groups: list.items, complete: list.complete }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'profile-groups', error) }
    }
  }

  async search(platform: Platform, text: string): Promise<CommunitySearchResult> {
    const query = normalizeCommunityQuery(text)
    if (query === null) return { ok: false, reason: 'invalid-query' }
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    const { adapter, state } = session
    const key = query.toLowerCase()
    const pendingKey = `search:${key}`
    if (!this.fresh(state.searches.get(key)) && !state.pending.has(pendingKey)) {
      const now = this.clock()
      if (state.lastSearchAt !== null && now - state.lastSearchAt < COMMUNITY_SEARCH_COOLDOWN_MS) {
        return { ok: false, reason: 'cooldown' }
      }
      state.lastSearchAt = now
    }
    try {
      const page = await this.read(
        state,
        state.searches,
        pendingKey,
        key,
        MAX_SEARCHES,
        false,
        () => adapter.search(query, state.lease)
      )
      if (this.states.get(platform) !== state) return { ok: false, reason: 'not-authenticated' }
      for (const person of page.people) this.remember(state, person.userId)
      return {
        ok: true,
        platform,
        query,
        people: page.people,
        worlds: this.options.adoptWorlds(platform, page.worlds)
      }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'search', error) }
    }
  }

  async getWorldList(
    platform: Platform,
    list: WorldList,
    refresh = false
  ): Promise<WorldListResult> {
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    const { adapter, state } = session
    try {
      const evidence = await this.read(
        state,
        state.lists,
        `world-list:${list}`,
        list,
        2,
        refresh,
        () => adapter.getWorldList(list, state.lease)
      )
      if (this.states.get(platform) !== state) return { ok: false, reason: 'not-authenticated' }
      return { ok: true, platform, list, worlds: this.options.adoptWorlds(platform, evidence) }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'world-list', error) }
    }
  }

  async getPlayersOnline(platform: Platform): Promise<PlayersOnlineResult> {
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    const { adapter, state } = session
    try {
      const value = await this.read(
        state,
        state.playersOnline,
        'players-online',
        'count',
        1,
        false,
        async () => {
          const count = await adapter.getPlayersOnline(state.lease)
          // A reply without a count is not cached as zero.
          if (count === null) throw new Error('No player count')
          return { count, checkedAt: this.wallClock() }
        }
      )
      return { ok: true, platform, ...value }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'players-online', error) }
    }
  }

  async getMyGroups(platform: Platform, refresh = false): Promise<MyGroupsResult> {
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    const { adapter, state } = session
    try {
      const list = await this.read(state, state.myGroups, 'my-groups', 'mine', 1, refresh, () =>
        adapter.getMyGroups(state.lease)
      )
      return { ok: true, platform, groups: list.items, complete: list.complete }
    } catch (error) {
      return { ok: false, reason: this.failure(platform, 'my-groups', error) }
    }
  }

  /** Whether a search listed this person during the current session. */
  knowsPerson(platform: Platform, userId: string): boolean {
    if (!isCommunityUserId(platform, userId)) return false
    const id = platform === 'chilloutvr' ? userId.toLowerCase() : userId
    return this.session(platform)?.state.known.has(id) ?? false
  }

  /** Forget a platform's answers at a sign-out, account change, or dead session. */
  clearPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  private person(
    platform: Platform,
    userId: string
  ):
    | { ok: true; adapter: CommunityAdapter; state: PlatformState; id: string }
    | { ok: false; reason: 'not-authenticated' | 'unknown-person' } {
    if (!isCommunityUserId(platform, userId)) return { ok: false, reason: 'unknown-person' }
    // ChilloutVR GUIDs compare case-insensitively; VRChat IDs are kept as sent.
    const id = platform === 'chilloutvr' ? userId.toLowerCase() : userId
    const session = this.session(platform)
    if (!session) return { ok: false, reason: 'not-authenticated' }
    if (!session.state.known.has(id) && !this.options.isFriend(platform, id)) {
      return { ok: false, reason: 'unknown-person' }
    }
    return { ok: true, ...session, id }
  }

  private remember(state: PlatformState, userId: string): void {
    state.known.delete(userId)
    state.known.add(userId)
    while (state.known.size > MAX_KNOWN_PEOPLE) {
      state.known.delete(state.known.values().next().value!)
    }
  }

  private async read<K, T>(
    state: PlatformState,
    cache: Map<K, Cached<T>>,
    pendingKey: string,
    key: K,
    max: number,
    refresh: boolean,
    load: () => Promise<T>
  ): Promise<T> {
    const cached = cache.get(key)
    if (
      cached &&
      this.fresh(cached) &&
      !(refresh && this.clock() - cached.at >= COMMUNITY_REFRESH_MIN_MS)
    ) {
      return cached.value
    }
    const running = state.pending.get(pendingKey) as Promise<T> | undefined
    if (running) return running
    const started = (async () => {
      const value = await load()
      assertRequestLease(state.lease)
      if (this.isCurrentState(state)) {
        cache.delete(key)
        cache.set(key, { value, at: this.clock() })
        while (cache.size > max) cache.delete(cache.keys().next().value!)
      }
      return value
    })().finally(() => {
      if (state.pending.get(pendingKey) === started) state.pending.delete(pendingKey)
    })
    state.pending.set(pendingKey, started)
    return started
  }

  private fresh<T>(cached: Cached<T> | undefined): cached is Cached<T> {
    return cached !== undefined && this.clock() - cached.at < COMMUNITY_CACHE_MS
  }

  private isCurrentState(state: PlatformState): boolean {
    return [...this.states.values()].includes(state)
  }

  private session(platform: Platform): { adapter: CommunityAdapter; state: PlatformState } | null {
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return null
    let lease: RequestLease
    try {
      lease = adapter.captureCommunityLease()
    } catch {
      this.states.delete(platform)
      return null
    }
    const existing = this.states.get(platform)
    if (
      existing &&
      existing.lease.generation === lease.generation &&
      existing.lease.isCurrent() &&
      !existing.lease.signal.aborted
    ) {
      return { adapter, state: existing }
    }
    const state: PlatformState = {
      lease,
      profiles: new Map(),
      profileWorlds: new Map(),
      profileGroups: new Map(),
      searches: new Map(),
      lists: new Map(),
      myGroups: new Map(),
      playersOnline: new Map(),
      pending: new Map(),
      known: new Set(),
      lastSearchAt: null
    }
    this.states.set(platform, state)
    return { adapter, state }
  }

  private failure(platform: Platform, kind: ReadKind, error: unknown): CommunityFailure {
    const reason: CommunityFailure =
      error instanceof AuthError
        ? 'not-authenticated'
        : error instanceof RateLimitError || error instanceof RequestQueueFullError
          ? 'rate-limited'
          : 'unavailable'
    this.log('community request failed', { platform, kind, reason })
    return reason
  }
}
