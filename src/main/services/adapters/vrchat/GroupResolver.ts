/**
 * VRChat group metadata resolver (VRX-260).
 *
 * Bounded TTL cache around `GET /groups/{groupId}`. Group name and icon are
 * optional enrichments: a missing/private group negative-caches to null so the
 * dashboard and detail sheet degrade gracefully. Authentication errors propagate
 * so the adapter can fence a dead session.
 *
 * Mirrors the bounded CvrInstanceResolver pattern (createCvrInstanceResolver)
 * rather than the older unbounded WorldResolver class.
 */

import { z } from 'zod'
import type { AdapterRequestOptions } from '../BaseAdapter'
import { AuthError } from '../errors'

// ─── Raw API shape (defensive) ────────────────────────────────────────────────

const rawGroupSchema = z.object({
  /** Group display name is the only critical field; a missing name is unusable. */
  name: z.string(),
  iconUrl: z.string().nullable().catch(null).optional()
})

// ─── Result type ──────────────────────────────────────────────────────────────

export interface GroupMeta {
  name: string
  iconUrl: string | null
}

export interface GroupResolver {
  /**
   * Resolve group metadata, cached. Returns `null` when the group can't be
   * resolved (private/deleted/gone or a transient API failure). Authentication
   * errors propagate so the adapter can invalidate the dead session.
   */
  resolve(
    groupId: string,
    options?: Pick<AdapterRequestOptions, 'priority'>
  ): Promise<GroupMeta | null>
  /**
   * Cache-only lookup for synchronous enrichment paths: the resolved value,
   * `null` for a cached failure, or `undefined` when this id was never resolved
   * (or its entry expired) — callers treat `undefined` as "kick `resolve`".
   */
  peek(groupId: string | null): GroupMeta | null | undefined
  /**
   * Drop every account-scoped cache entry and detach in-flight work. Results
   * from requests started before the clear are discarded when they settle.
   */
  clear(): void
}

export interface GroupFetcher {
  (groupId: string, options?: Pick<AdapterRequestOptions, 'priority'>): Promise<unknown>
}

// ─── Cache tuning ─────────────────────────────────────────────────────────────

/** Success TTL — group metadata changes rarely; mirror the world cache window. */
export const GROUP_CACHE_TTL_MS = 86_400_000

/** Failure TTL — same rationale as CVR instance negative caching. */
export const GROUP_NEGATIVE_TTL_MS = 60_000

interface CacheEntry {
  expiresAt: number
  value: GroupMeta | null
}

/**
 * Cache-size ceiling. Ever-changing group rosters would otherwise grow the map
 * for the process lifetime. At the ceiling: sweep expired entries; if still
 * over, evict oldest-inserted (Map preserves insertion order).
 */
export const GROUP_CACHE_MAX = 512

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createGroupResolver(options: {
  fetcher: GroupFetcher
  /** Injected clock for TTL tests; defaults to Date.now. */
  clock?: () => number
  ttlMs?: number
  negativeTtlMs?: number
  maxEntries?: number
}): GroupResolver {
  const { fetcher } = options
  const clock = options.clock ?? Date.now
  const ttlMs = options.ttlMs ?? GROUP_CACHE_TTL_MS
  const negativeTtlMs = options.negativeTtlMs ?? GROUP_NEGATIVE_TTL_MS
  const maxEntries = options.maxEntries ?? GROUP_CACHE_MAX

  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<GroupMeta | null>>()
  let generation = 0

  function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
    return entry !== undefined && entry.expiresAt > clock()
  }

  /** Bounded-growth guard — see GROUP_CACHE_MAX. */
  function store(groupId: string, entry: CacheEntry): void {
    if (cache.size >= maxEntries && !cache.has(groupId)) {
      const now = clock()
      for (const [key, existing] of cache) {
        if (existing.expiresAt <= now) cache.delete(key)
      }
      while (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    }
    cache.set(groupId, entry)
  }

  async function fetchAndCache(
    groupId: string,
    requestGeneration: number,
    options?: Pick<AdapterRequestOptions, 'priority'>
  ): Promise<GroupMeta | null> {
    try {
      const raw = await fetcher(groupId, options)
      const parsed = rawGroupSchema.safeParse(raw)
      if (!parsed.success) {
        // Treat an unparseable group body as a negative-cache miss so a bad
        // response shape can't crash enrichment.
        if (requestGeneration === generation) {
          store(groupId, { expiresAt: clock() + negativeTtlMs, value: null })
        }
        return null
      }
      const value: GroupMeta = {
        name: parsed.data.name,
        iconUrl: parsed.data.iconUrl ?? null
      }
      if (requestGeneration === generation) {
        store(groupId, { expiresAt: clock() + ttlMs, value })
      }
      return value
    } catch (error) {
      // A dead session must reach VrcAdapter's auth-invalidated boundary.
      if (error instanceof AuthError) throw error

      // Private/deleted groups and non-auth transient failures negative-cache to
      // null so repeated roster/snapshot cycles don't hammer the API.
      if (requestGeneration === generation) {
        store(groupId, { expiresAt: clock() + negativeTtlMs, value: null })
      }
      return null
    }
  }

  return {
    resolve(
      groupId: string,
      options?: Pick<AdapterRequestOptions, 'priority'>
    ): Promise<GroupMeta | null> {
      const cached = cache.get(groupId)
      if (fresh(cached)) return Promise.resolve(cached.value)

      const pending = inFlight.get(groupId)
      if (pending) {
        if (options?.priority === 'interactive') {
          return fetchAndCache(groupId, generation, options)
        }
        return pending
      }

      const requestGeneration = generation
      const request = fetchAndCache(groupId, requestGeneration, options).finally(() => {
        if (inFlight.get(groupId) === request) inFlight.delete(groupId)
      })
      inFlight.set(groupId, request)
      return request
    },

    peek(groupId: string | null): GroupMeta | null | undefined {
      if (groupId === null) return undefined
      const cached = cache.get(groupId)
      return fresh(cached) ? cached.value : undefined
    },

    clear(): void {
      generation += 1
      cache.clear()
      inFlight.clear()
    }
  }
}
