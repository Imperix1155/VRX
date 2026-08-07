import { dehydrate, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query'
import type {
  PersistedClient,
  Persister,
  PersistQueryClientOptions
} from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { z } from 'zod'
import { MAX_FRIENDS } from '@shared/constants'

/**
 * Schema version for the TanStack Query persisted cache (VRX-155).
 *
 * Bump this when the shape of what we persist changes (e.g. a new required
 * query-key namespace or an incompatible state migration). It is combined with
 * the app version to build the cache buster, so a schema bump automatically
 * discards older persisted payloads on the next cold start.
 */
export const CACHE_SCHEMA_VERSION = 1

/** localStorage key used by the sync storage persister for the dehydrated cache. */
export const QUERY_CACHE_STORAGE_KEY = 'vrx-query-cache'

/**
 * Persisted cache envelope older than this is discarded on hydration.
 *
 * Note: this bounds time-since-last-WRITE, not data age. Every throttled save
 * and every `persistQueryCacheNow` call re-stamps the envelope timestamp, so
 * maxAge does not limit how old the roster data itself is. Restored queries are
 * invalidated-on-restore so they refetch in the background; that is the actual
 * staleness defense. True data-age bound: VRX-253.
 */
export const MAX_QUERY_AGE_MS = 24 * 60 * 60 * 1000

/** Query-key namespaces that are allowed to be persisted. */
export const PERSISTED_NAMESPACES = ['friends'] as const

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
 * - `friends` rosters are small and make the cold-start friends list paint
 *   immediately.
 * - `avatar` / `image` queries are base64-heavy and are excluded.
 * - Only successful queries are persisted; pending, paused, and errored queries
 *   are excluded so they cannot poison the cache. 'error' keeps the query
 *   enabled → a refetch will disprove stale data, so it is not quarantined; it
 *   is also never persisted.
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

const platformSchema = z.enum(['vrchat', 'chilloutvr'])
const instanceSchema = z
  .object({
    worldId: z.string(),
    instanceId: z.string(),
    worldName: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    type: z.enum([
      'public',
      'friends-plus',
      'friends',
      'invite-plus',
      'invite',
      'group-public',
      'group-plus',
      'group',
      'friends-of-friends',
      'everyone-can-invite',
      'owner-must-invite',
      'friends-of-members',
      'members-only',
      'offline'
    ]),
    openness: z.enum(['public', 'friends-plus', 'friends', 'invite-plus', 'invite', 'offline']),
    opennessUnknown: z.boolean().optional(),
    isGroup: z.boolean(),
    groupName: z.string().nullable(),
    region: z.string().nullable(),
    userCount: z.number().int().nonnegative().nullable()
  })
  .strict()
const friendBaseShape = {
  platformUserId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  instance: instanceSchema.nullable(),
  isFavorite: z.boolean(),
  favoriteGroupIds: z.array(z.string()),
  linkedPersonId: z.string().nullable()
}
const friendSchema = z.discriminatedUnion('platform', [
  z
    .object({
      ...friendBaseShape,
      platform: z.literal('vrchat'),
      presence: z.object({ state: z.enum(['in-game', 'active', 'offline']) }).strict(),
      status: z.enum(['join-me', 'online', 'ask-me', 'dnd']).nullable(),
      statusDescription: z.string().nullable(),
      trustRank: z.enum(['visitor', 'new', 'user', 'known', 'trusted', 'nuisance']).nullable()
    })
    .strict(),
  z
    .object({
      ...friendBaseShape,
      platform: z.literal('chilloutvr'),
      presence: z.object({ state: z.enum(['in-game', 'offline']) }).strict(),
      status: z.null(),
      statusDescription: z.null(),
      trustRank: z.null()
    })
    .strict()
])
const persistedQuerySchema = z
  .object({
    dehydratedAt: z.number().finite().nonnegative().optional(),
    queryHash: z.string(),
    queryKey: z.tuple([z.literal('friends'), platformSchema]),
    state: z
      .object({
        data: z.array(friendSchema).max(MAX_FRIENDS),
        dataUpdateCount: z.number().int().nonnegative(),
        dataUpdatedAt: z.number().finite().nonnegative(),
        error: z.null(),
        errorUpdateCount: z.number().int().nonnegative(),
        errorUpdatedAt: z.number().finite().nonnegative(),
        fetchFailureCount: z.number().int().nonnegative(),
        fetchFailureReason: z.null(),
        fetchMeta: z.null(),
        isInvalidated: z.boolean(),
        status: z.literal('success'),
        fetchStatus: z.enum(['idle', 'fetching', 'paused'])
      })
      .strict(),
    promise: z.null().optional()
  })
  .strict()
  .superRefine((query, context) => {
    const platform = query.queryKey[1]
    if (query.queryHash !== JSON.stringify(query.queryKey)) {
      context.addIssue({ code: 'custom', message: 'queryHash does not match queryKey' })
    }
    if (query.state.data.some((friend) => friend.platform !== platform)) {
      context.addIssue({ code: 'custom', message: 'friend platform does not match query key' })
    }
  })
  .transform(({ promise, ...query }) => {
    void promise
    return query
  })
const persistedClientSchema = z
  .object({
    timestamp: z.number().finite().nonnegative(),
    buster: z.string(),
    clientState: z
      .object({
        mutations: z.array(z.never()).length(0),
        queries: z.array(persistedQuerySchema).max(2)
      })
      .strict()
  })
  .strict()
  .superRefine((client, context) => {
    const keys = client.clientState.queries.map((query) => query.queryKey[1])
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'duplicate friends query' })
    }
  })

function discardedPersistedClient(): PersistedClient {
  return { timestamp: 0, buster: '', clientState: { mutations: [], queries: [] } }
}

/** Parse the persisted cache as untrusted input; any mismatch discards it whole. */
export function deserializePersistedQueryCache(serialized: string): PersistedClient {
  try {
    const parsed = persistedClientSchema.safeParse(JSON.parse(serialized) as unknown)
    return parsed.success ? parsed.data : discardedPersistedClient()
  } catch {
    return discardedPersistedClient()
  }
}

const dehydrateOptions = {
  shouldDehydrateQuery,
  shouldDehydrateMutation: (): boolean => false
}

/**
 * Create the sync storage persister. The persister is created on demand so
 * node-based unit tests can import the pure helpers above without requiring
 * `window.localStorage` to exist.
 */
export function createQueryCachePersister(): Persister {
  let storage: Storage | undefined
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    storage = undefined
  }
  return createSyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    deserialize: deserializePersistedQueryCache
  })
}

/**
 * Build the persist options object used by both production and tests. Sharing
 * the object guarantees that tests exercise the same buster, maxAge
 * (time-since-last-write; true data-age bound is VRX-253), and dehydration
 * filter as the real renderer root.
 */
export function buildPersistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: createQueryCachePersister(),
    buster: buildCacheBuster(),
    maxAge: MAX_QUERY_AGE_MS,
    dehydrateOptions
  }
}

/** Persist the corrected current cache synchronously at an identity/auth boundary. */
export function persistQueryCacheNow(queryClient: QueryClient): void {
  if (typeof window === 'undefined') return
  try {
    const persistedClient: PersistedClient = {
      buster: buildCacheBuster(),
      timestamp: Date.now(),
      clientState: dehydrate(queryClient, dehydrateOptions)
    }
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, JSON.stringify(persistedClient))
  } catch {
    // The in-memory boundary is authoritative when storage is unavailable.
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
  // A future instance query must include platform in its key and define its own eviction shape.
}
