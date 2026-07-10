import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { CvrFetcher } from './fetchCvrFriends'
import {
  CVR_INSTANCE_CACHE_MAX,
  CVR_INSTANCE_NEGATIVE_TTL_MS,
  CVR_INSTANCE_TTL_MS,
  createCvrInstanceResolver
} from './resolveCvrInstance'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Instance tags built via interpolation so a literal "#123456" doesn't trip the
// design-token raw-color guard (same pattern as worldName.test.ts).
const withTag = (name: string, tag: string): string => `${name} (#${tag})`

const fullDetail = {
  id: 'i+abc123',
  name: withTag('SunDown', '816332'),
  world: {
    id: 'wrld-guid-1',
    name: 'SunDown',
    imageUrl: 'https://files.abinteractive.net/w/1.png'
  },
  currentPlayerCount: 7,
  instanceSettingPrivacy: 0
}

/** Fetcher stub that validates through the schema like CvrApiClient.get does. */
function makeFetcher(payload: unknown): { fetcher: CvrFetcher; calls: string[] } {
  const calls: string[] = []
  const fetcher: CvrFetcher = <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    calls.push(path)
    return Promise.resolve(schema.parse(payload))
  }
  return { fetcher, calls }
}

// ─── resolve ──────────────────────────────────────────────────────────────────

describe('createCvrInstanceResolver', () => {
  it('resolves and maps world fields (clean name, true world id, image, count)', async () => {
    const { fetcher, calls } = makeFetcher(fullDetail)
    const resolver = createCvrInstanceResolver({ fetcher })

    const resolved = await resolver.resolve('i+abc123')
    expect(resolved).toEqual({
      instanceId: 'i+abc123',
      instanceName: withTag('SunDown', '816332'),
      worldId: 'wrld-guid-1',
      worldName: 'SunDown',
      worldImageUrl: 'https://files.abinteractive.net/w/1.png',
      playerCount: 7,
      privacy: 0
    })
    expect(calls).toEqual(['/instances/i%2Babc123']) // URI-encoded path (VRX-51 class)
  })

  it('degrades enrichment fields to null when world is missing (defensive parse)', async () => {
    const { fetcher } = makeFetcher({ id: 'i+bare' })
    const resolver = createCvrInstanceResolver({ fetcher })

    const resolved = await resolver.resolve('i+bare')
    expect(resolved).toEqual({
      instanceId: 'i+bare',
      instanceName: null,
      worldId: null,
      worldName: null,
      worldImageUrl: null,
      playerCount: null,
      privacy: null
    })
  })

  it('serves from cache within the TTL and re-fetches after it expires', async () => {
    let now = 1_000_000
    const { fetcher, calls } = makeFetcher(fullDetail)
    const resolver = createCvrInstanceResolver({ fetcher, clock: () => now })

    await resolver.resolve('i+abc123')
    now += CVR_INSTANCE_TTL_MS - 1
    await resolver.resolve('i+abc123')
    expect(calls).toHaveLength(1) // within TTL — no second fetch (VRX-59 AC)

    now += 2 // cross the TTL boundary
    await resolver.resolve('i+abc123')
    expect(calls).toHaveLength(2)
  })

  it('dedupes concurrent resolves of the same id into one fetch', async () => {
    let release!: (v: unknown) => void
    const gate = new Promise((r) => {
      release = r
    })
    const calls: string[] = []
    const fetcher: CvrFetcher = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
      calls.push(path)
      await gate
      return schema.parse(fullDetail)
    }
    const resolver = createCvrInstanceResolver({ fetcher })

    const [a, b] = [resolver.resolve('i+abc123'), resolver.resolve('i+abc123')]
    release(undefined)
    const [ra, rb] = await Promise.all([a, b])
    expect(calls).toHaveLength(1)
    expect(ra).toEqual(rb)
  })

  it('returns null (never throws) on fetch failure and negative-caches it briefly', async () => {
    let now = 5_000_000
    let fail = true
    const calls: string[] = []
    const fetcher: CvrFetcher = <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
      calls.push(path)
      if (fail) return Promise.reject(new Error('404 private instance'))
      return Promise.resolve(schema.parse(fullDetail))
    }
    const resolver = createCvrInstanceResolver({ fetcher, clock: () => now })

    await expect(resolver.resolve('i+priv')).resolves.toBeNull()
    now += CVR_INSTANCE_NEGATIVE_TTL_MS - 1
    await expect(resolver.resolve('i+priv')).resolves.toBeNull()
    expect(calls).toHaveLength(1) // failure cached — no hammering within the window

    // After the (shorter) negative TTL a transient failure self-heals.
    now += 2
    fail = false
    const recovered = await resolver.resolve('i+priv')
    expect(recovered?.worldId).toBe('wrld-guid-1')
    expect(calls).toHaveLength(2)
  })

  it('peek returns undefined before resolve, the value after, and undefined after expiry', async () => {
    let now = 9_000_000
    const { fetcher } = makeFetcher(fullDetail)
    const resolver = createCvrInstanceResolver({ fetcher, clock: () => now })

    expect(resolver.peek('i+abc123')).toBeUndefined()
    await resolver.resolve('i+abc123')
    expect(resolver.peek('i+abc123')?.worldName).toBe('SunDown')

    now += CVR_INSTANCE_TTL_MS + 1
    expect(resolver.peek('i+abc123')).toBeUndefined()
  })

  it('caps the cache: at the ceiling the oldest entry is evicted, recent ones survive', async () => {
    const calls: string[] = []
    const fetcher: CvrFetcher = <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
      calls.push(path)
      return Promise.resolve(schema.parse({ ...fullDetail, id: path }))
    }
    const resolver = createCvrInstanceResolver({ fetcher })

    // Fill to the cap, then one more — evicts the oldest-inserted ('id-0').
    for (let i = 0; i <= CVR_INSTANCE_CACHE_MAX; i++) {
      await resolver.resolve(`id-${i}`)
    }
    expect(resolver.peek('id-0')).toBeUndefined() // evicted
    expect(resolver.peek(`id-${CVR_INSTANCE_CACHE_MAX}`)).not.toBeUndefined() // newest kept
    expect(resolver.peek('id-2')).not.toBeUndefined() // only ONE eviction was needed

    const callsBefore = calls.length
    await resolver.resolve('id-0') // re-resolves (was evicted)
    await resolver.resolve('id-5') // cached — no fetch
    expect(calls.length).toBe(callsBefore + 1)
  })

  it('peek distinguishes a cached failure (null) from never-resolved (undefined)', async () => {
    const fetcher: CvrFetcher = vi.fn(() => Promise.reject(new Error('boom')))
    const resolver = createCvrInstanceResolver({ fetcher })

    await resolver.resolve('i+dead')
    expect(resolver.peek('i+dead')).toBeNull()
    expect(resolver.peek('i+other')).toBeUndefined()
  })
})
