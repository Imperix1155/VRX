// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { Query, QueryKey } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import {
  buildCacheBuster,
  CACHE_SCHEMA_VERSION,
  createQueryCachePersister,
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

  it('excludes errored queries even when their key is otherwise persistable', async () => {
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
    expect(shouldDehydrateQuery(query!)).toBe(false)
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
