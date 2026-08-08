// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { Query, QueryKey } from '@tanstack/react-query'
import { dehydrate, QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import type { Friend } from '@shared/types'
import {
  buildCacheBuster,
  buildPersistOptions,
  CACHE_SCHEMA_VERSION,
  createQueryCachePersister,
  deserializePersistedQueryCache,
  persistQueryCacheNow,
  QUERY_CACHE_STORAGE_KEY,
  shouldDehydrateQuery
} from './cache'

function fullFriend(name: string, platform: Friend['platform']): Friend {
  return {
    platformUserId: `usr_${name.toLowerCase()}`,
    platform,
    displayName: name,
    avatarUrl: null,
    // Platform-true presence: the persisted-cache schema's CVR variant only
    // allows 'in-game' | 'offline'.
    presence: { state: platform === 'chilloutvr' ? 'in-game' : 'active' },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as unknown as Friend
}

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
    expect((cvrRestored?.state.data as Friend[])[0]?.displayName).toBe('CvrFriend')
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

describe('createQueryCachePersister', () => {
  it('does not throw when acquiring localStorage fails', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('denied')
      },
      configurable: true
    })
    expect(() => createQueryCachePersister()).not.toThrow()
    if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor)
  })
})
