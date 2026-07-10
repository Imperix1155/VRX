/**
 * CVR instance-details resolver (VRX-59).
 *
 * `GET /instances/{id}` carries what the WS `ONLINE_FRIENDS` event lacks: a
 * `world: { id, name, imageUrl }` object SEPARATE from the creator-set instance
 * label (`name`, e.g. "Bono's Movie Night (#teehee)"), plus the player count.
 * Resolved data lets the dashboard group CVR hot cards by the TRUE world id
 * (the WS gives none, so worldId currently falls back to the instance id) and
 * show the clean `world.name` with no display-side suffix stripping.
 *
 * Shape confirmed against CVRX's source and the owner's prior app (2026-07-10);
 * defensive parsing per docs/api-volatility.md — only `id` is critical, every
 * enrichment field degrades to null rather than failing the resolve.
 *
 * Pure + dependency-injected (no electron imports): the injected fetcher is
 * `CvrApiClient.get` in production, which already carries auth headers, the
 * BaseAdapter rate limiter, and typed errors — so this module adds caching and
 * failure semantics only.
 */

import { z } from 'zod'
import type { CvrFetcher } from './fetchCvrFriends'

// ─── Raw API shape (defensive) ────────────────────────────────────────────────

const rawCvrInstanceDetailSchema = z.object({
  id: z.string(),
  /** Creator-set instance label — may embed a "(#tag)" suffix; NOT the world name. */
  name: z.string().nullable().catch(null).optional(),
  world: z
    .object({
      id: z.string(),
      name: z.string().nullable().catch(null).optional(),
      imageUrl: z.string().nullable().catch(null).optional()
    })
    .nullable()
    .catch(null)
    .optional(),
  currentPlayerCount: z.number().int().nonnegative().nullable().catch(null).optional(),
  /** Numeric on the live wire, string in CVRX docs — parseCvrPrivacy takes both. */
  instanceSettingPrivacy: z.union([z.string(), z.number()]).nullable().catch(null).optional()
})

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ResolvedCvrInstance {
  instanceId: string
  /** Full creator-set instance label (keeps any "(#tag)") — for the detail panel. */
  instanceName: string | null
  /** TRUE world id — the dashboard's cross-instance grouping key. */
  worldId: string | null
  /** Clean world name (no instance suffix) — display uses this verbatim. */
  worldName: string | null
  worldImageUrl: string | null
  playerCount: number | null
  /** Raw privacy value for parseCvrPrivacy (getInstanceDetails); null when absent. */
  privacy: string | number | null
}

export interface CvrInstanceResolver {
  /**
   * Resolve instance details, cached. Returns `null` when the instance can't be
   * resolved (private/hidden/gone or a transient API failure) — never throws.
   */
  resolve(instanceId: string): Promise<ResolvedCvrInstance | null>
  /**
   * Cache-only lookup for synchronous enrichment paths: the resolved value,
   * `null` for a cached failure, or `undefined` when this id was never resolved
   * (or its entry expired) — callers treat `undefined` as "kick `resolve`".
   */
  peek(instanceId: string): ResolvedCvrInstance | null | undefined
}

// ─── Cache tuning ─────────────────────────────────────────────────────────────

/** Success TTL — instances are more volatile than worlds (VRX-59 AC: 5 min). */
export const CVR_INSTANCE_TTL_MS = 5 * 60_000
/**
 * Failure TTL — long enough that a dead/private instance isn't hammered on
 * every snapshot delta, short enough that a transient API blip self-heals well
 * before the success TTL would.
 */
export const CVR_INSTANCE_NEGATIVE_TTL_MS = 60_000

interface CacheEntry {
  expiresAt: number
  value: ResolvedCvrInstance | null
}

/**
 * Cache-size ceiling. Expired entries are only overwritten on re-resolve, so a
 * long-lived adapter seeing ever-new instance ids would otherwise grow the map
 * for the process lifetime (Sol review, Med). At the ceiling: sweep expired
 * entries; if still over, evict oldest-inserted (Map preserves insertion order).
 */
export const CVR_INSTANCE_CACHE_MAX = 512

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCvrInstanceResolver(options: {
  fetcher: CvrFetcher
  /** Injected clock for TTL tests; defaults to Date.now. */
  clock?: () => number
  ttlMs?: number
  negativeTtlMs?: number
}): CvrInstanceResolver {
  const { fetcher } = options
  const clock = options.clock ?? Date.now
  const ttlMs = options.ttlMs ?? CVR_INSTANCE_TTL_MS
  const negativeTtlMs = options.negativeTtlMs ?? CVR_INSTANCE_NEGATIVE_TTL_MS

  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<ResolvedCvrInstance | null>>()

  function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
    return entry !== undefined && entry.expiresAt > clock()
  }

  /** Bounded-growth guard — see CVR_INSTANCE_CACHE_MAX. */
  function store(instanceId: string, entry: CacheEntry): void {
    if (cache.size >= CVR_INSTANCE_CACHE_MAX && !cache.has(instanceId)) {
      const now = clock()
      for (const [key, existing] of cache) {
        if (existing.expiresAt <= now) cache.delete(key)
      }
      // Still full after the sweep → evict oldest-inserted until under the cap.
      while (cache.size >= CVR_INSTANCE_CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    }
    cache.set(instanceId, entry)
  }

  async function fetchAndCache(instanceId: string): Promise<ResolvedCvrInstance | null> {
    try {
      // Encode: the id arrives from the WS wire — it must never be able to
      // rewrite the authenticated request path (VRX-51 path-injection class).
      const raw = await fetcher(
        `/instances/${encodeURIComponent(instanceId)}`,
        rawCvrInstanceDetailSchema
      )
      const value: ResolvedCvrInstance = {
        instanceId,
        instanceName: raw.name ?? null,
        worldId: raw.world?.id ?? null,
        worldName: raw.world?.name ?? null,
        worldImageUrl: raw.world?.imageUrl ?? null,
        playerCount: raw.currentPlayerCount ?? null,
        privacy: raw.instanceSettingPrivacy ?? null
      }
      store(instanceId, { expiresAt: clock() + ttlMs, value })
      return value
    } catch {
      // Private/hidden/deleted instances and transient failures all land here —
      // the resolve contract is null-not-throw (VRX-59 AC), negative-cached so
      // repeated snapshots don't hammer the API.
      store(instanceId, { expiresAt: clock() + negativeTtlMs, value: null })
      return null
    }
  }

  return {
    resolve(instanceId: string): Promise<ResolvedCvrInstance | null> {
      const cached = cache.get(instanceId)
      if (fresh(cached)) return Promise.resolve(cached.value)

      const pending = inFlight.get(instanceId)
      if (pending) return pending

      const request = fetchAndCache(instanceId).finally(() => {
        inFlight.delete(instanceId)
      })
      inFlight.set(instanceId, request)
      return request
    },

    peek(instanceId: string): ResolvedCvrInstance | null | undefined {
      const cached = cache.get(instanceId)
      return fresh(cached) ? cached.value : undefined
    }
  }
}
