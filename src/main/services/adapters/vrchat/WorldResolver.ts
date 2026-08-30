/**
 * VRChat world metadata resolver with TTL cache (VRX-46)
 *
 * Fetches `name`, `thumbnailUrl`, and `capacity` from the VRChat
 * `/worlds/:worldId` endpoint. Responses are cached in-memory for
 * WORLD_CACHE_TTL_MS (24 h) within one account generation — the same worldId
 * within TTL hits the cache, and `peek()` lets latency-sensitive callers read
 * that cache without starting I/O. `clear()` drops account-scoped entries and
 * fences late writes when the adapter changes session.
 *
 * Designed to be:
 * - Electron-free and unit-testable (injected fetcher + injected clock)
 * - Dependency-injected (does NOT subclass or import VrcApiClient/VrcAdapter)
 * - Defensive (unknown / deleted world → null); the ONE exception is a dead
 *   session (AuthError), which propagates so the adapter can react (VRX-197)
 *
 * Injected fetcher contract:
 *   (worldId: string) => Promise<unknown>
 * The fetcher is responsible for making the authenticated GET request to
 * `/worlds/:worldId` and resolving with the raw JSON body. If the world is
 * deleted / not found the fetcher SHOULD resolve with a non-matching value
 * (e.g. null or a non-object) rather than throw, but WorldResolver wraps all
 * fetcher calls in try/catch and returns null on any rejection, so a throwing
 * fetcher (e.g. one that throws on 404) is also safe.
 */

import { z } from 'zod'
import { WORLD_CACHE_TTL_MS } from '@shared/constants'
import { AuthError } from '../errors'

/**
 * Failure TTL for WorldResolver (VRX-254). Long enough that a deleted/private
 * world isn't hammered on every live event for it, short enough that a
 * transient API blip self-heals well before the success TTL would.
 */
export const WORLD_NEGATIVE_CACHE_TTL_MS = 60_000

/** The typed world-metadata shape this resolver produces. */
export interface WorldMeta {
  name: string
  thumbnailUrl: string | null
  /** null = the API omitted it or sent garbage (api-volatility: "missing capacity → unknown"). */
  capacity: number | null
  shortName: string | null
}

/**
 * The raw VRChat `/worlds/:id` response shape we care about.
 * `thumbnailImageUrl` is the actual field name in the VRChat API; we map it
 * to `thumbnailUrl` on `WorldMeta` so callers see a normalised contract.
 *
 * Only `name` is critical — a world with no name has nothing to show. Every
 * other field is enrichment, so each degrades independently to null via
 * `.catch(null)` (missing key, wrong type, anything). Before the 2026-07 audit
 * (W4), a REQUIRED `capacity` meant one missing unused field nulled the whole
 * world — name and thumbnail included — falsifying api-volatility.md's
 * "missing capacity → unknown" promise.
 */
const WorldApiSchema = z.object({
  name: z.string(),
  thumbnailImageUrl: z.string().nullable().catch(null),
  capacity: z.number().int().nullable().catch(null),
  shortName: z.string().nullable().catch(null)
})

interface CacheEntry {
  meta: WorldMeta | null
  expiresAt: number
}

export class WorldResolver {
  private readonly fetcher: (worldId: string) => Promise<unknown>
  private readonly clock: () => number
  private readonly negativeTtlMs: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly writeEpoch = new Map<string, number>()
  private generation = 0

  constructor(
    fetcher: (worldId: string) => Promise<unknown>,
    clock: () => number = Date.now,
    negativeTtlMs: number = WORLD_NEGATIVE_CACHE_TTL_MS
  ) {
    this.fetcher = fetcher
    this.clock = clock
    this.negativeTtlMs = negativeTtlMs
  }

  /**
   * Synchronous cache-only lookup.
   * - `undefined` = unresolved or expired (a fresh fetch may start).
   * - `null` = negative-cached recent failure (within `WORLD_NEGATIVE_CACHE_TTL_MS`).
   * - `WorldMeta` = cache hit.
   */
  peek(worldId: string | null): WorldMeta | null | undefined {
    if (!worldId) return null
    const cached = this.cache.get(worldId)
    if (cached === undefined) return undefined
    if (cached.expiresAt <= this.clock()) {
      this.cache.delete(worldId)
      return undefined
    }
    return cached.meta
  }

  /**
   * Drop account-scoped cache entries and fence writes from requests launched
   * before the boundary. The stale caller may still receive its own result, but
   * it cannot repopulate or overwrite the replacement account's cache.
   */
  clear(): void {
    this.generation += 1
    this.cache.clear()
    this.writeEpoch.clear()
  }

  /**
   * Resolve a worldId to its metadata.
   *
   * - `null` / private location (no worldId) → returns `null`.
   * - Cache hit within WORLD_CACHE_TTL_MS → returns cached value without fetching.
   * - Deleted / unknown world, fetch failure, or unexpected response shape → `null`.
   */
  async resolve(worldId: string | null): Promise<WorldMeta | null> {
    if (!worldId) return null

    const cached = this.peek(worldId)
    if (cached !== undefined) return cached
    const requestGeneration = this.generation
    // A later same-account request owns the cache write even if an older fetch
    // settles last. Both callers still receive their own response.
    const requestEpoch = (this.writeEpoch.get(worldId) ?? 0) + 1
    this.writeEpoch.set(worldId, requestEpoch)
    const mayWrite = (): boolean =>
      requestGeneration === this.generation && this.writeEpoch.get(worldId) === requestEpoch

    let raw: unknown
    try {
      raw = await this.fetcher(worldId)
    } catch (error) {
      // A dead cookie (AuthError) mid-enrichment must NOT be swallowed to null —
      // it propagates so VrcAdapter can emit auth-invalidated from its background
      // enrichment boundary (VRX-197/214). Every OTHER failure still
      // degrades to null so world resolution never breaks the friend list.
      if (error instanceof AuthError) throw error
      if (mayWrite()) {
        this.cache.set(worldId, { meta: null, expiresAt: this.clock() + this.negativeTtlMs })
      }
      return null
    }

    const parsed = WorldApiSchema.safeParse(raw)
    if (!parsed.success) {
      if (mayWrite()) {
        this.cache.set(worldId, { meta: null, expiresAt: this.clock() + this.negativeTtlMs })
      }
      return null
    }

    const meta: WorldMeta = {
      name: parsed.data.name,
      thumbnailUrl: parsed.data.thumbnailImageUrl,
      capacity: parsed.data.capacity,
      shortName: parsed.data.shortName
    }

    if (mayWrite()) {
      this.cache.set(worldId, { meta, expiresAt: this.clock() + WORLD_CACHE_TTL_MS })
    }
    return meta
  }
}
