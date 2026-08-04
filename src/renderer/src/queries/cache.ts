import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Persister, PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

/**
 * Schema version for the TanStack Query persisted cache (VRX-155).
 *
 * Bump this when the shape of what we persist changes (e.g. a new required
 * query-key namespace or an incompatible state migration). It is combined with
 * the app version and the cache epoch to build the cache buster, so a schema
 * bump automatically discards older persisted payloads on the next cold start.
 */
export const CACHE_SCHEMA_VERSION = 1

/** localStorage key used by the sync storage persister for the dehydrated cache. */
export const QUERY_CACHE_STORAGE_KEY = 'vrx-query-cache'

/**
 * localStorage key for the renderer-local cache epoch. The epoch is bumped on
 * every identity/auth boundary and folded into the buster so a payload written
 * under a previous account/session cannot restore after a restart, even if a
 * throttled persister write leaks after the boundary wipe.
 */
export const QUERY_CACHE_EPOCH_KEY = 'vrx-query-cache-epoch'

/** Persisted queries older than this are discarded on hydration (24 hours). */
export const MAX_QUERY_AGE_MS = 24 * 60 * 60 * 1000

/** Query-key namespaces that are allowed to be persisted. */
export const PERSISTED_NAMESPACES = ['friends', 'instance'] as const

/**
 * Read the current cache epoch from localStorage. Defaults to 0 when unset or
 * unreadable.
 */
export function getCacheEpoch(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(QUERY_CACHE_EPOCH_KEY)
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  } catch {
    return 0
  }
}

/**
 * Bump the cache epoch and persist it to localStorage. Returns the new epoch.
 * Called on identity and auth boundaries before wiping the cache so any
 * subsequently-written payload is tagged with the old epoch and discarded on
 * the next cold start.
 */
export function bumpCacheEpoch(): number {
  if (typeof window === 'undefined') return 0
  try {
    const next = getCacheEpoch() + 1
    window.localStorage.setItem(QUERY_CACHE_EPOCH_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

/**
 * Build the cache buster that ties the persisted cache to the current app
 * release, schema version, and identity epoch. `__APP_VERSION__` is injected at
 * build time (electron.vite.config.ts) and mirrored by vitest.config.ts under
 * tests.
 */
export function buildCacheBuster(): string {
  return `${__APP_VERSION__}.${CACHE_SCHEMA_VERSION}.${getCacheEpoch()}`
}

/**
 * Dehydration filter (VRX-155). Only small, valuable server state is persisted:
 *
 * - `friends` rosters and `instance` queries are cheap and make the cold-start
 *   friends list paint immediately.
 * - `avatar` / `image` queries are base64-heavy and are excluded.
 * - Only successful queries are persisted; pending, paused, and errored queries
 *   are excluded so they cannot poison the cache.
 * - Everything else (auth status, friend notes, etc.) is intentionally
 *   re-fetched per session.
 */
export function shouldDehydrateQuery(query: Query<unknown, Error, unknown, QueryKey>): boolean {
  if (query.state.status !== 'success') return false
  const key = query.queryKey
  if (!Array.isArray(key) || key.length === 0) return false
  const namespace: unknown = key[0]
  if (typeof namespace !== 'string') return false
  return PERSISTED_NAMESPACES.includes(namespace as (typeof PERSISTED_NAMESPACES)[number])
}

/**
 * Create the sync storage persister. The persister is created on demand so
 * node-based unit tests can import the pure helpers above without requiring
 * `window.localStorage` to exist.
 */
export function createQueryCachePersister(): Persister {
  return createSyncStoragePersister({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    key: QUERY_CACHE_STORAGE_KEY
  })
}

/**
 * Build the persist options object used by both production and tests. Sharing
 * the object guarantees that tests exercise the same buster, maxAge, and
 * dehydration filter as the real renderer root.
 */
export function buildPersistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: createQueryCachePersister(),
    buster: buildCacheBuster(),
    maxAge: MAX_QUERY_AGE_MS,
    dehydrateOptions: { shouldDehydrateQuery }
  }
}

/**
 * Restore callback for PersistQueryClientProvider. Hydrated data came from disk,
 * so it must be treated as stale. The persister restores `dataUpdatedAt`
 * verbatim, and `useFriends` can use an Infinity `staleTime` on the 'manual'
 * reconcile cadence, which would leave a restored roster un-refetched
 * indefinitely. Invalidate the persisted namespaces so the initial paint is
 * immediately followed by a revalidate (VRX-22 SWR behavior is otherwise
 * unchanged).
 */
export function onPersistRestore(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['friends'] })
  void queryClient.invalidateQueries({ queryKey: ['instance'] })
}

/**
 * Remove the persisted query cache from localStorage. Called on identity and
 * auth boundaries so a signed-out / switched account can never see the previous
 * account's roster after a restart.
 */
export function clearPersistedQueryCache(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY)
  } catch {
    // Storage may be disabled/quota-ed; the in-memory cache is already cleared
    // by the boundary handler, so ignore a localStorage failure here.
  }
}

/**
 * Schedule an extra localStorage wipe after the persister's 1s throttle window
 * has flushed. The boundary handler's own cache mutations can schedule a
 * throttled write that lands *after* the synchronous removeItem, so we remove
 * the key a second time once that race window is closed.
 */
export function schedulePersistedCacheWipe(): number {
  clearPersistedQueryCache()
  if (typeof window === 'undefined') return 0
  return window.setTimeout(() => {
    clearPersistedQueryCache()
  }, 1500)
}
