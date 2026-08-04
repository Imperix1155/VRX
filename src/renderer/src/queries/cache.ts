import type { Query, QueryKey } from '@tanstack/react-query'
import type { Persister } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

/**
 * Schema version for the TanStack Query persisted cache (VRX-155).
 *
 * Bump this when the shape of what we persist changes (e.g. a new required
 * query-key namespace or a incompatible state migration). It is combined with
 * the app version to build the cache buster, so a schema bump automatically
 * discards older persisted payloads on the next cold start.
 */
export const CACHE_SCHEMA_VERSION = 1

/** localStorage key used by the sync storage persister. */
export const QUERY_CACHE_STORAGE_KEY = 'vrx-query-cache'

/** Persisted queries older than this are discarded on hydration (24 hours). */
export const MAX_QUERY_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Build the cache buster that ties the persisted cache to the current app
 * release and schema version. `__APP_VERSION__` is injected at build time
 * (electron.vite.config.ts) and mirrored by vitest.config.ts under tests.
 */
export function buildCacheBuster(): string {
  return `${__APP_VERSION__}.${CACHE_SCHEMA_VERSION}`
}

/**
 * Dehydration filter (VRX-155). Only small, valuable server state is persisted:
 *
 * - `friends` rosters and `instance` queries are cheap and make the cold-start
 *   friends list paint immediately.
 * - `avatar` / `image` queries are base64-heavy and are excluded.
 * - Errored queries are excluded so a stale failure does not poison the cache.
 * - Everything else (auth status, friend notes, etc.) is intentionally
 *   re-fetched per session.
 */
export function shouldDehydrateQuery(query: Query<unknown, Error, unknown, QueryKey>): boolean {
  if (query.state.status === 'error') return false
  const key = query.queryKey
  if (!Array.isArray(key) || key.length === 0) return false
  const namespace: unknown = key[0]
  if (typeof namespace !== 'string') return false
  if (namespace === 'friends') return true
  if (namespace === 'instance') return true
  return false
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
