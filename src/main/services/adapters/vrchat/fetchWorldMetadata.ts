/**
 * VRChat parallel world metadata fetcher with concurrency limit (VRX-47)
 *
 * Fans out `resolver.resolve()` calls over a deduplicated set of worldIds,
 * keeping at most CONCURRENCY_LIMIT requests in flight at once via a simple
 * promise-pool (no external dependency). Null/undefined/"" inputs are dropped
 * before the pool runs. The resolver's own TTL cache handles repeated ids
 * from session to session; the dedupe here handles repeated ids within a
 * single batch call.
 */

import type { WorldMeta, WorldResolver } from './WorldResolver'

/** Maximum concurrent `resolver.resolve()` calls in a single batch. */
const CONCURRENCY_LIMIT = 10

/**
 * Resolve a batch of worldIds to their metadata.
 *
 * - Deduplicates ids (a repeated worldId resolves once).
 * - Drops null / undefined / empty-string entries.
 * - Runs resolver.resolve() with at most `concurrencyLimit` calls in flight.
 * - Returns a Map keyed by worldId; private/unknown worlds (null result) are omitted.
 *
 * @param worldIds   Raw id array (may contain nulls, undefineds, duplicates).
 * @param resolver   WorldResolver instance to delegate fetches to.
 * @param concurrencyLimit  Max parallel resolves (default: CONCURRENCY_LIMIT).
 */
export async function fetchWorldMetadata(
  worldIds: ReadonlyArray<string | null | undefined>,
  resolver: WorldResolver,
  concurrencyLimit = CONCURRENCY_LIMIT
): Promise<Map<string, WorldMeta>> {
  const ids = [...new Set(worldIds.filter((id): id is string => Boolean(id)))]

  if (ids.length === 0) return new Map()

  const result = new Map<string, WorldMeta>()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      const meta = await resolver.resolve(id)
      if (meta !== null) {
        result.set(id, meta)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, ids.length) }, worker)
  await Promise.all(workers)

  return result
}
