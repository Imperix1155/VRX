import { describe, expect, it } from 'vitest'
import { WorldResolver } from './WorldResolver'
import { fetchWorldMetadata } from './fetchWorldMetadata'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A resolver backed by a simple map; records call count per id. */
function makeSimpleResolver(): {
  resolver: WorldResolver
  callCount: Map<string, number>
} {
  const callCount = new Map<string, number>()
  const fetcher = async (worldId: string): Promise<unknown> => {
    callCount.set(worldId, (callCount.get(worldId) ?? 0) + 1)
    return { name: `World ${worldId}`, capacity: 10 }
  }
  return { resolver: new WorldResolver(fetcher), callCount }
}

/**
 * A resolver that tracks peak in-flight concurrency.
 * Each resolve() increments a counter on entry, records the peak, then
 * waits for a shared gate promise before returning — released all at once
 * so the pool is forced to fill up.
 */
function makeConcurrencyTrackingResolver(releaseAll: () => void): {
  resolver: WorldResolver
  peakConcurrent: () => number
  triggerRelease: () => void
} {
  let current = 0
  let peak = 0
  let releaseResolve: (() => void) | null = null

  // Callers release by calling triggerRelease(); until then all resolves block.
  const gate = new Promise<void>((res) => {
    releaseResolve = res
  })

  const fetcher = async (_worldId: string): Promise<unknown> => {
    current++
    if (current > peak) peak = current
    releaseAll() // notify the test that at least one worker is waiting
    await gate
    current--
    return { name: `World ${_worldId}`, capacity: 10 }
  }

  return {
    resolver: new WorldResolver(fetcher),
    peakConcurrent: () => peak,
    triggerRelease: () => releaseResolve?.()
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchWorldMetadata', () => {
  // ── Empty input ──────────────────────────────────────────────────────────────

  it('returns empty Map for empty input', async () => {
    const { resolver } = makeSimpleResolver()
    const result = await fetchWorldMetadata([], resolver)
    expect(result.size).toBe(0)
  })

  it('returns empty Map when all inputs are null/undefined/empty', async () => {
    const { resolver } = makeSimpleResolver()
    const result = await fetchWorldMetadata([null, undefined, '', null], resolver)
    expect(result.size).toBe(0)
  })

  // ── Dedupe ───────────────────────────────────────────────────────────────────

  it('resolves a repeated worldId exactly once', async () => {
    const { resolver, callCount } = makeSimpleResolver()
    const result = await fetchWorldMetadata(['wrld_a', 'wrld_a', 'wrld_a'], resolver)

    expect(callCount.get('wrld_a')).toBe(1)
    expect(result.size).toBe(1)
    expect(result.has('wrld_a')).toBe(true)
  })

  it('dedupes while still resolving distinct ids', async () => {
    const { resolver, callCount } = makeSimpleResolver()
    await fetchWorldMetadata(['wrld_a', 'wrld_b', 'wrld_a'], resolver)

    expect(callCount.get('wrld_a')).toBe(1)
    expect(callCount.get('wrld_b')).toBe(1)
  })

  // ── Null / empty filtering ───────────────────────────────────────────────────

  it('drops null and undefined entries', async () => {
    const { resolver, callCount } = makeSimpleResolver()
    const result = await fetchWorldMetadata([null, 'wrld_a', undefined, null], resolver)

    expect(callCount.get('wrld_a')).toBe(1)
    expect(result.size).toBe(1)
  })

  it('drops empty-string entries', async () => {
    const { resolver, callCount } = makeSimpleResolver()
    const result = await fetchWorldMetadata(['', 'wrld_a', ''], resolver)

    expect(callCount.get('wrld_a')).toBe(1)
    expect(result.size).toBe(1)
  })

  // ── Correct Map result ───────────────────────────────────────────────────────

  it('returns a Map keyed by worldId with correct WorldMeta', async () => {
    const fetcher = async (worldId: string): Promise<unknown> => ({
      name: `World ${worldId}`,
      thumbnailImageUrl: `https://cdn.example.com/${worldId}.jpg`,
      capacity: 20
    })
    const resolver = new WorldResolver(fetcher)
    const result = await fetchWorldMetadata(['wrld_a', 'wrld_b'], resolver)

    expect(result.size).toBe(2)
    expect(result.get('wrld_a')).toEqual({
      name: 'World wrld_a',
      thumbnailUrl: 'https://cdn.example.com/wrld_a.jpg',
      capacity: 20
    })
    expect(result.get('wrld_b')).toEqual({
      name: 'World wrld_b',
      thumbnailUrl: 'https://cdn.example.com/wrld_b.jpg',
      capacity: 20
    })
  })

  // ── Null results omitted ─────────────────────────────────────────────────────

  it('omits worlds where the resolver returns null (private/unknown)', async () => {
    const fetcher = async (worldId: string): Promise<unknown> => {
      if (worldId === 'wrld_private') return null
      return { name: `World ${worldId}`, capacity: 10 }
    }
    const resolver = new WorldResolver(fetcher)
    const result = await fetchWorldMetadata(['wrld_a', 'wrld_private', 'wrld_b'], resolver)

    expect(result.has('wrld_private')).toBe(false)
    expect(result.size).toBe(2)
  })

  // ── Concurrency limit ────────────────────────────────────────────────────────

  it('never exceeds the concurrency limit of 10 in-flight calls', async () => {
    // 25 distinct ids, default limit 10. We block all resolves on a gate,
    // let the pool fill up, then measure the peak concurrent count.
    const ids = Array.from({ length: 25 }, (_, i) => `wrld_${i}`)

    let triggered = false
    const { resolver, peakConcurrent, triggerRelease } = makeConcurrencyTrackingResolver(() => {
      triggered = true
    })

    const fetchPromise = fetchWorldMetadata(ids, resolver)

    // Yield to the microtask queue so the pool workers start running
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Release the gate so all blocked resolves can complete
    triggerRelease()
    await fetchPromise

    expect(triggered).toBe(true)
    expect(peakConcurrent()).toBeLessThanOrEqual(10)
    // With 25 ids and limit 10, peak must be exactly 10
    expect(peakConcurrent()).toBe(10)
  })

  it('respects a custom concurrency limit', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `wrld_${i}`)

    const { resolver, peakConcurrent, triggerRelease } = makeConcurrencyTrackingResolver(() => {})

    const fetchPromise = fetchWorldMetadata(ids, resolver, 5)

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    triggerRelease()
    await fetchPromise

    expect(peakConcurrent()).toBeLessThanOrEqual(5)
    expect(peakConcurrent()).toBe(5)
  })
})
