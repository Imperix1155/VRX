// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { Query, QueryKey } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import {
  buildCacheBuster,
  CACHE_SCHEMA_VERSION,
  clearPersistedQueryCache,
  QUERY_CACHE_STORAGE_KEY,
  shouldDehydrateQuery
} from './cache'

describe('query cache constants', () => {
  it('builds a buster from app version and the schema version', () => {
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

  it('includes friends queries', () => {
    client.setQueryData(['friends', 'vrchat'], [{ id: 'a' }])
    const query = findQuery(['friends', 'vrchat'])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(true)
  })

  it('includes instance queries', () => {
    client.setQueryData(['instance', 'wrld_123'], { id: 'wrld_123' })
    const query = findQuery(['instance', 'wrld_123'])
    expect(query).toBeTruthy()
    expect(shouldDehydrateQuery(query!)).toBe(true)
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

describe('clearPersistedQueryCache', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
  })

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
  })

  it('removes the vrx query-cache localStorage entry', () => {
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, '{"clientState":{}}')
    clearPersistedQueryCache()
    expect(window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('is a no-op when localStorage is unavailable', () => {
    const original = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        removeItem: () => {
          throw new Error('denied')
        }
      },
      configurable: true
    })
    expect(() => clearPersistedQueryCache()).not.toThrow()
    Object.defineProperty(window, 'localStorage', { value: original, configurable: true })
  })
})
