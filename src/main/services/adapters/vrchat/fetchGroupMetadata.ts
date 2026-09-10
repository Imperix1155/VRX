/**
 * VRChat parallel group metadata fetcher (VRX-260)
 *
 * Mirrors fetchWorldMetadata but fans out `resolver.resolve()` calls over a
 * deduplicated set of groupIds. The resolver's bounded TTL cache handles
 * repeated ids across batches; the dedupe here handles repeated ids within a
 * single batch call.
 */

import { CONCURRENCY_LIMIT } from '@shared/constants'
import type { GroupMeta, GroupResolver } from './GroupResolver'

/**
 * Resolve a batch of groupIds to their metadata.
 *
 * - Deduplicates ids (a repeated groupId resolves once).
 * - Drops null / undefined / empty-string entries.
 * - Runs resolver.resolve() with at most `concurrencyLimit` calls in flight.
 * - Calls `onResolved` immediately for each non-null answer, when supplied.
 * - Returns a Map keyed by groupId; private/unknown groups (null result) are omitted.
 *
 * @param groupIds   Raw id array (may contain nulls, undefineds, duplicates).
 * @param resolver   GroupResolver instance to delegate fetches to.
 * @param concurrencyLimit  Max parallel resolves (default: CONCURRENCY_LIMIT).
 * @param onResolved Optional incremental callback; does not wait for the batch.
 * @param canContinue Optional account-generation guard checked before every resolve.
 * @param onFailure Optional synchronous notification of each resolve failure.
 */
export async function fetchGroupMetadata(
  groupIds: ReadonlyArray<string | null | undefined>,
  resolver: GroupResolver,
  concurrencyLimit = CONCURRENCY_LIMIT,
  onResolved?: (groupId: string, meta: GroupMeta) => void,
  canContinue: () => boolean = () => true,
  onFailure?: (error: unknown) => void
): Promise<Map<string, GroupMeta>> {
  const ids = [...new Set(groupIds.filter((id): id is string => Boolean(id)))]

  if (ids.length === 0) return new Map()

  const result = new Map<string, GroupMeta>()
  let cursor = 0
  let failed = false
  let failure: unknown

  function stop(error: unknown): void {
    onFailure?.(error)
    if (failed) return
    failed = true
    failure = error
  }

  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      if (failed || !canContinue()) break
      const id = ids[cursor++]
      if (id === undefined) break // bounds-narrowing for noUncheckedIndexedAccess (audit W7)
      let meta: GroupMeta | null
      try {
        meta = await resolver.resolve(id)
      } catch (error) {
        stop(error)
        break
      }
      if (meta !== null) {
        result.set(id, meta)
        onResolved?.(id, meta)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, ids.length) }, worker)
  await Promise.all(workers)
  if (failed) throw failure

  return result
}
