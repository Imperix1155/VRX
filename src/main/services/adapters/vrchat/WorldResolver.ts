/**
 * VRChat world metadata resolver with TTL cache (VRX-46)
 *
 * Fetches `name`, `thumbnailUrl`, and `capacity` from the VRChat
 * `/worlds/:worldId` endpoint. Responses are cached in-memory for
 * WORLD_CACHE_TTL_MS (24 h) — the same worldId within TTL hits the cache.
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
import { AuthError } from '../errors'

/** 24-hour TTL for cached world metadata (ms). */
export const WORLD_CACHE_TTL_MS = 24 * 60 * 60 * 1000

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
  meta: WorldMeta
  fetchedAt: number
}

export class WorldResolver {
  private readonly fetcher: (worldId: string) => Promise<unknown>
  private readonly clock: () => number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(fetcher: (worldId: string) => Promise<unknown>, clock: () => number = Date.now) {
    this.fetcher = fetcher
    this.clock = clock
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

    const now = this.clock()
    const cached = this.cache.get(worldId)
    if (cached !== undefined && now - cached.fetchedAt < WORLD_CACHE_TTL_MS) {
      return cached.meta
    }

    let raw: unknown
    try {
      raw = await this.fetcher(worldId)
    } catch (error) {
      // A dead cookie (AuthError) mid-enrichment must NOT be swallowed to null —
      // it propagates so VrcAdapter.getFriends can emit auth-invalidated (Codex,
      // VRX-197). Every OTHER failure (deleted world, 404, network blip) still
      // degrades to null so world resolution never breaks the friend list.
      if (error instanceof AuthError) throw error
      return null
    }

    const parsed = WorldApiSchema.safeParse(raw)
    if (!parsed.success) return null

    const meta: WorldMeta = {
      name: parsed.data.name,
      thumbnailUrl: parsed.data.thumbnailImageUrl,
      capacity: parsed.data.capacity,
      shortName: parsed.data.shortName
    }

    this.cache.set(worldId, { meta, fetchedAt: now })
    return meta
  }
}

/**
 * Convert a world's shortName to a vrch.at short link.
 *
 * - `shortName` present → returns `https://vrch.at/<shortName>`
 * - `shortName` null or undefined → returns `null`
 */
export function worldShortLink(shortName: string | null): string | null {
  if (!shortName) return null
  return `https://vrch.at/${shortName}`
}
