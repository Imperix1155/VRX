// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { Query, QueryKey } from '@tanstack/react-query'
import { dehydrate, QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import type { Friend } from '@shared/types'
import { fullFriend } from '../test-utils/friendFixture'
import {
  buildCacheBuster,
  buildPersistOptions,
  CACHE_SCHEMA_VERSION,
  createQueryCachePersister,
  deserializePersistedQueryCache,
  MAX_QUERY_AGE_MS,
  persistQueryCacheNow,
  QUERY_CACHE_STORAGE_KEY,
  shouldDehydrateQuery
} from './cache'

describe('query cache buster', () => {
  it('builds a static buster from app version and schema version', () => {
    expect(buildCacheBuster()).toBe(`${__APP_VERSION__}.${CACHE_SCHEMA_VERSION}`)
  })
})

describe('shouldDehydrateQuery', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    client.clear()
  })

  function findQuery(key: unknown[]): Query<unknown, Error, unknown, QueryKey> | undefined {
    return client.getQueryCache().find({ queryKey: key, exact: true })
  }

  it('includes successful friends queries', () => {
    client.setQueryData(['friends', 'vrchat'], [{ id: 'a' }])
    const query = findQuery(['friends', 'vrchat'])
    expect(query).toBeTruthy()
    expect(query!.state.status).toBe('success')
    expect(shouldDehydrateQuery(query!)).toBe(true)
  })

  it('excludes instance queries until they have a platform key and eviction contract', () => {
    client.setQueryData(['instance', 'wrld_123'], { id: 'wrld_123' })
    const query = findQuery(['instance', 'wrld_123'])
    expect(query).toBeTruthy()
    expect(query!.state.status).toBe('success')
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('excludes pending queries in an allowed namespace', async () => {
    // Start a fetch that never resolves so the query stays pending.
    const promise = new Promise<unknown[]>(() => {})
    const pendingFetch = client.fetchQuery({
      queryKey: ['friends', 'vrchat'],
      queryFn: () => promise,
      retry: false
    })
    const query = findQuery(['friends', 'vrchat'])
    expect(query).toBeTruthy()
    expect(query!.state.status).toBe('pending')
    expect(shouldDehydrateQuery(query!)).toBe(false)
    // Cancel and catch the pending fetch so the shared afterEach clear() does
    // not surface the cancellation as an unhandled rejection.
    void client.cancelQueries({ queryKey: ['friends', 'vrchat'] })
    await expect(pendingFetch).rejects.toThrow()
  })

  it('excludes avatar queries', () => {
    client.setQueryData(['avatar', 'https://example.com/a.png'], 'dataUrl')
    const query = findQuery(['avatar', 'https://example.com/a.png'])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('excludes image queries', () => {
    client.setQueryData(['image', 'https://example.com/b.png'], 'dataUrl')
    const query = findQuery(['image', 'https://example.com/b.png'])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('excludes auth-status queries', () => {
    client.setQueryData(['auth-status', 'vrchat'], { state: 'authenticated' })
    const query = findQuery(['auth-status', 'vrchat'])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('excludes friend-note queries', () => {
    client.setQueryData(['friend-note', 'vrchat', 'usr_a', 0], { note: 'hi' })
    const query = findQuery(['friend-note', 'vrchat', 'usr_a', 0])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('excludes an errored query that never held data', async () => {
    await expect(
      client.fetchQuery({
        queryKey: ['friends', 'vrchat'],
        queryFn: () => Promise.reject(new Error('network')),
        retry: false
      })
    ).rejects.toThrow('network')
    const query = findQuery(['friends', 'vrchat'])
    expect(query).toBeTruthy()
    expect(query!.state.status).toBe('error')
    expect(query!.state.data).toBeUndefined()
    expect(shouldDehydrateQuery(query!)).toBe(false)
  })

  it('keeps a query whose background refetch failed — the last good data must persist', () => {
    // query-core keeps `data` and only flips status to 'error' on a failed
    // background refetch. That last good roster is exactly what the warm
    // cold-start paint needs during an outage/rate-limit — it must dehydrate.
    client.setQueryData(['friends', 'chilloutvr'], [{ id: 'cvr-friend' }])
    const query = findQuery(['friends', 'chilloutvr'])
    expect(query).toBeTruthy()
    query!.setState({
      ...query!.state,
      status: 'error',
      error: new Error('outage'),
      fetchStatus: 'idle',
      isInvalidated: true
    })
    expect(query!.state.status).toBe('error')
    expect(query!.state.data).toBeDefined()
    expect(shouldDehydrateQuery(query!)).toBe(true)
  })
})

describe('persistQueryCacheNow — outage survival (round-4 F-A regression)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a platform whose background refetch failed keeps its last good roster on disk, verified through the real restore path', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['friends', 'vrchat'], [fullFriend('VrcFriend', 'vrchat')])
    client.setQueryData(['friends', 'chilloutvr'], [fullFriend('CvrFriend', 'chilloutvr')])
    const cvr = client.getQueryCache().find({ queryKey: ['friends', 'chilloutvr'], exact: true })
    expect(cvr).toBeTruthy()
    cvr!.setState({
      ...cvr!.state,
      status: 'error',
      error: new Error('outage'),
      fetchStatus: 'idle',
      isInvalidated: true
    })

    persistQueryCacheNow(client)

    // Assert through the REAL restore path (schema validation and all), not a
    // raw JSON.parse of bytes a real restore might reject.
    const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const restored = deserializePersistedQueryCache(raw!)
    const keys = restored.clientState.queries.map((q) => q.queryKey)
    expect(keys).toContainEqual(['friends', 'chilloutvr'])
    expect(keys).toContainEqual(['friends', 'vrchat'])
    const cvrRestored = restored.clientState.queries.find(
      (q) => JSON.stringify(q.queryKey) === JSON.stringify(['friends', 'chilloutvr'])
    )
    expect((cvrRestored?.state.data as Friend[] | undefined)?.[0]?.displayName).toBe('CvrFriend')
    client.clear()
  })
})

describe('write-path normalization — logout-after-outage (round-2 re-review F1+F2 regression)', () => {
  it('a manual write after a failed refetch stays restorable through the THROTTLED serialize path, both platforms intact', async () => {
    // Manual setQueryData after a failed refetch yields status:'success' with
    // fetchFailureReason still holding a live Error (query-core clears it only
    // on non-manual success). A success-status early-return in the normalizer
    // skipped that shape; JSON.stringify(Error) is {}, the strict schema then
    // discarded the WHOLE envelope — both platforms lost on ordinary logout.
    // This one test binds BOTH the serialize hook's presence and the
    // normalizer's unconditional form.
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      client.setQueryData(['friends', 'vrchat'], [fullFriend('VrcFriend', 'vrchat')])
      client.setQueryData(['friends', 'chilloutvr'], [fullFriend('CvrFriend', 'chilloutvr')])
      // Real failed background refetch: data retained, fetchFailureReason set.
      await expect(
        client.fetchQuery({
          queryKey: ['friends', 'chilloutvr'],
          queryFn: () => Promise.reject(new Error('cvr outage')),
          retry: false
        })
      ).rejects.toThrow('cvr outage')
      // Logout-shaped manual write: success status, retained fetchFailureReason.
      client.setQueryData(['friends', 'chilloutvr'], [])

      const options = buildPersistOptions()
      const persisted: PersistedClient = {
        buster: buildCacheBuster(),
        timestamp: Date.now(),
        clientState: dehydrate(client, options.dehydrateOptions)
      }
      void options.persister.persistClient(persisted)
      await vi.advanceTimersByTimeAsync(1200) // past the persister's 1s throttle

      const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)
      expect(raw).toBeTruthy()
      const restored = deserializePersistedQueryCache(raw!)
      const keys = restored.clientState.queries.map((q) => q.queryKey)
      expect(keys).toContainEqual(['friends', 'vrchat'])
      expect(keys).toContainEqual(['friends', 'chilloutvr'])
      client.clear()
    } finally {
      vi.useRealTimers()
    }
  })
})

function buildPersistedClientEnvelope(
  queries: Array<{
    platform: 'vrchat' | 'chilloutvr'
    dataUpdatedAt: number
    friends?: Friend[]
  }>,
  {
    timestamp = Date.now(),
    buster = buildCacheBuster()
  }: { timestamp?: number; buster?: string } = {}
): string {
  return JSON.stringify({
    timestamp,
    buster,
    clientState: {
      mutations: [],
      queries: queries.map((query) => {
        const key: ['friends', 'vrchat' | 'chilloutvr'] = ['friends', query.platform]
        return {
          dehydratedAt: timestamp,
          queryHash: JSON.stringify(key),
          queryKey: key,
          state: {
            data: query.friends ?? [fullFriend(`${query.platform}Friend`, query.platform)],
            dataUpdateCount: 1,
            dataUpdatedAt: query.dataUpdatedAt,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'success',
            fetchStatus: 'idle'
          }
        }
      })
    }
  })
}

describe('deserializePersistedQueryCache — data-age bound (VRX-253)', () => {
  const now = 1_750_000_000_000

  beforeEach(() => {
    vi.useFakeTimers({ now })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a fresh query and drops a stale query from the same fresh envelope', () => {
    const serialized = buildPersistedClientEnvelope([
      { platform: 'vrchat', dataUpdatedAt: now - MAX_QUERY_AGE_MS + 1000 },
      { platform: 'chilloutvr', dataUpdatedAt: now - MAX_QUERY_AGE_MS - 1000 }
    ])
    const restored = deserializePersistedQueryCache(serialized)
    expect(restored.clientState.queries).toHaveLength(1)
    expect(restored.clientState.queries[0]!.queryKey).toEqual(['friends', 'vrchat'])
  })

  it('restores a query just inside the 24h boundary and drops one just outside', () => {
    const inside = buildPersistedClientEnvelope([
      { platform: 'vrchat', dataUpdatedAt: now - MAX_QUERY_AGE_MS + 1 }
    ])
    expect(deserializePersistedQueryCache(inside).clientState.queries).toHaveLength(1)

    // Exactly 24h old is still KEPT — the bound is inclusive ("older than 24
    // hours" drops). Pins <= against a <-mutation, which brackets alone miss.
    const exact = buildPersistedClientEnvelope([
      { platform: 'vrchat', dataUpdatedAt: now - MAX_QUERY_AGE_MS }
    ])
    expect(deserializePersistedQueryCache(exact).clientState.queries).toHaveLength(1)

    const outside = buildPersistedClientEnvelope([
      { platform: 'vrchat', dataUpdatedAt: now - MAX_QUERY_AGE_MS - 1 }
    ])
    expect(deserializePersistedQueryCache(outside).clientState.queries).toHaveLength(0)
  })

  it('treats a zero dataUpdatedAt as stale and drops it without crashing', () => {
    const serialized = buildPersistedClientEnvelope([{ platform: 'vrchat', dataUpdatedAt: 0 }])
    const restored = deserializePersistedQueryCache(serialized)
    expect(restored.clientState.queries).toHaveLength(0)
  })

  it('a missing dataUpdatedAt drops ONLY that query — the other platform survives', () => {
    // Two-query envelope: vrchat OMITS dataUpdatedAt, chilloutvr is fresh.
    // This binds the schema's .default(0): with it, the malformed query parses
    // at 0 and only IT is filtered; without it, strict validation rejects the
    // envelope WHOLE and both platforms' rosters are lost (boundary-safety law).
    const serialized = JSON.stringify({
      timestamp: now,
      buster: buildCacheBuster(),
      clientState: {
        mutations: [],
        queries: [
          {
            dehydratedAt: now,
            queryHash: JSON.stringify(['friends', 'vrchat']),
            queryKey: ['friends', 'vrchat'],
            state: {
              data: [fullFriend('VrcFriend', 'vrchat')],
              dataUpdateCount: 1,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle'
            }
          },
          {
            dehydratedAt: now,
            queryHash: JSON.stringify(['friends', 'chilloutvr']),
            queryKey: ['friends', 'chilloutvr'],
            state: {
              data: [fullFriend('CvrFriend', 'chilloutvr')],
              dataUpdateCount: 1,
              dataUpdatedAt: now - 1000,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle'
            }
          }
        ]
      }
    })
    const restored = deserializePersistedQueryCache(serialized)
    expect(restored.clientState.queries).toHaveLength(1)
    expect(restored.clientState.queries[0]!.queryKey).toEqual(['friends', 'chilloutvr'])
  })
})

describe('createQueryCachePersister', () => {
  it('does not throw when acquiring localStorage fails', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('denied')
      },
      configurable: true
    })
    try {
      expect(() => createQueryCachePersister()).not.toThrow()
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor)
    }
  })
})

describe('legacy cache tolerance — VRX-260 group fields', () => {
  it('hydrates an envelope whose InstanceInfo lacks groupId / groupImageUrl', () => {
    const legacy: PersistedClient = {
      timestamp: Date.now(),
      buster: buildCacheBuster(),
      clientState: {
        mutations: [],
        queries: [
          {
            dehydratedAt: Date.now(),
            queryHash: JSON.stringify(['friends', 'vrchat']),
            queryKey: ['friends', 'vrchat'],
            state: {
              data: [
                {
                  platform: 'vrchat',
                  platformUserId: 'usr_legacy',
                  displayName: 'Legacy',
                  avatarUrl: null,
                  presence: { state: 'active' },
                  status: 'online',
                  statusDescription: null,
                  trustRank: null,
                  instance: {
                    worldId: 'wrld_legacy',
                    instanceId: 'i_legacy',
                    worldName: 'Legacy World',
                    thumbnailUrl: null,
                    type: 'group',
                    openness: 'invite',
                    isGroup: true,
                    groupName: null,
                    region: 'us',
                    userCount: null
                  },
                  isFavorite: false,
                  favoriteGroupIds: [],
                  linkedPersonId: null
                }
              ],
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle'
            }
          }
        ]
      }
    }

    const restored = deserializePersistedQueryCache(JSON.stringify(legacy))
    const friend = (restored.clientState.queries[0]!.state.data as Friend[])[0]
    expect(friend).toBeTruthy()
    expect(friend?.instance?.groupId).toBeNull()
    expect(friend?.instance?.groupImageUrl).toBeNull()
  })

  it('discards the ENTIRE envelope when a groupId is present but wrong-typed', () => {
    const envelope: PersistedClient = {
      timestamp: Date.now(),
      buster: buildCacheBuster(),
      clientState: {
        mutations: [],
        queries: [
          {
            dehydratedAt: Date.now(),
            queryHash: JSON.stringify(['friends', 'vrchat']),
            queryKey: ['friends', 'vrchat'],
            state: {
              data: [
                {
                  platform: 'vrchat',
                  platformUserId: 'usr_bad_type',
                  displayName: 'Bad Type',
                  avatarUrl: null,
                  presence: { state: 'active' },
                  status: 'online',
                  statusDescription: null,
                  trustRank: null,
                  instance: {
                    worldId: 'wrld_bad',
                    instanceId: 'i_bad',
                    worldName: 'Bad World',
                    thumbnailUrl: null,
                    type: 'group',
                    openness: 'invite',
                    isGroup: true,
                    groupName: null,
                    groupId: 42,
                    groupImageUrl: null,
                    region: 'us',
                    userCount: null
                  },
                  isFavorite: false,
                  favoriteGroupIds: [],
                  linkedPersonId: null
                }
              ],
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle'
            }
          }
        ]
      }
    }

    const restored = deserializePersistedQueryCache(JSON.stringify(envelope))
    expect(restored.clientState.queries).toHaveLength(0)
  })
})
