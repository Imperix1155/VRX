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
 * - Defensive (unknown / deleted world → null, never throws)
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

/** 24-hour TTL for cached world metadata (ms). */
export const WORLD_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** The typed world-metadata shape this resolver produces. */
export interface WorldMeta {
  name: string
  thumbnailUrl: string | null
  capacity: number
  shortName: string | null
}

/**
 * The raw VRChat `/worlds/:id` response shape we care about.
 * `thumbnailImageUrl` is the actual field name in the VRChat API; we map it
 * to `thumbnailUrl` on `WorldMeta` so callers see a normalised contract.
 */
const WorldApiSchema = z.object({
  name: z.string(),
  thumbnailImageUrl: z.string().nullable().optional(),
  capacity: z.number().int(),
  shortName: z.string().nullable().optional()
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
    } catch {
      return null
    }

    const parsed = WorldApiSchema.safeParse(raw)
    if (!parsed.success) return null

    const meta: WorldMeta = {
      name: parsed.data.name,
      thumbnailUrl: parsed.data.thumbnailImageUrl ?? null,
      capacity: parsed.data.capacity,
      shortName: parsed.data.shortName ?? null
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
