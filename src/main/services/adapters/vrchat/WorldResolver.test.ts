import { describe, expect, it, vi } from 'vitest'
import { WorldResolver, WORLD_CACHE_TTL_MS, worldShortLink } from './WorldResolver'

const VALID_WORLD_RAW = {
  name: 'The Great Pug',
  thumbnailImageUrl: 'https://example.com/pug.jpg',
  capacity: 20
}

const VALID_WORLD_META = {
  name: 'The Great Pug',
  thumbnailUrl: 'https://example.com/pug.jpg',
  capacity: 20,
  shortName: null
}

describe('WorldResolver', () => {
  // ── Null / missing worldId ───────────────────────────────────────────────────

  it('returns null immediately when worldId is null (no fetch)', async () => {
    const fetcher = vi.fn()
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve(null)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  // ── Valid response ───────────────────────────────────────────────────────────

  it('returns typed WorldMeta for a valid API response', async () => {
    const fetcher = vi.fn().mockResolvedValue(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toEqual(VALID_WORLD_META)
  })

  it('maps thumbnailImageUrl to thumbnailUrl', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...VALID_WORLD_RAW,
      thumbnailImageUrl: 'https://cdn.example.com/img.png'
    })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.thumbnailUrl).toBe('https://cdn.example.com/img.png')
  })

  it('returns null thumbnailUrl when thumbnailImageUrl is absent from response', async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: 'Empty World', capacity: 5 })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.thumbnailUrl).toBeNull()
  })

  // ── Cache hit within TTL ─────────────────────────────────────────────────────

  it('calls fetcher only once when the same worldId is resolved twice within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue(VALID_WORLD_RAW)
    const clock = vi.fn().mockReturnValue(1_000_000)
    const resolver = new WorldResolver(fetcher, clock)

    const first = await resolver.resolve('wrld_abc')
    const second = await resolver.resolve('wrld_abc')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  // ── Cache expiry (clock advancing past TTL) ──────────────────────────────────

  async function resolveWithAdvancedClock(advance: number): Promise<number> {
    let now = 0
    const clock = (): number => now
    const fetcher = vi.fn().mockResolvedValue(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher, clock)

    await resolver.resolve('wrld_abc')
    now += advance
    await resolver.resolve('wrld_abc')
    return fetcher.mock.calls.length
  }

  it('re-fetches after the TTL has elapsed', async () => {
    expect(await resolveWithAdvancedClock(WORLD_CACHE_TTL_MS + 1)).toBe(2)
  })

  it('re-fetches when clock advances exactly to the TTL boundary (strict < comparison)', async () => {
    // At exactly TTL ms elapsed, the entry is expired (strict <, not <=)
    expect(await resolveWithAdvancedClock(WORLD_CACHE_TTL_MS)).toBe(2)
  })

  // ── Different worldIds get separate cache entries ────────────────────────────

  it('fetches independently for different worldIds', async () => {
    const fetcher = vi.fn().mockResolvedValue(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher)

    await resolver.resolve('wrld_abc')
    await resolver.resolve('wrld_xyz')

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith('wrld_abc')
    expect(fetcher).toHaveBeenCalledWith('wrld_xyz')
  })

  // ── Unknown / garbage response → null, not a throw ──────────────────────────

  it('returns null for a completely garbage response shape', async () => {
    const fetcher = vi.fn().mockResolvedValue({ totally: 'wrong' })
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toBeNull()
  })

  it('returns null when the fetcher resolves with null (deleted/unknown world)', async () => {
    const fetcher = vi.fn().mockResolvedValue(null)
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toBeNull()
  })

  it('returns null when the fetcher resolves with a non-object primitive', async () => {
    const fetcher = vi.fn().mockResolvedValue(42)
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toBeNull()
  })

  // ── Fetcher errors → null, not a throw ──────────────────────────────────────

  it('returns null (does not throw) when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('404 not found'))
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toBeNull()
  })

  it('does not cache a null result — retries fetcher on next call', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(null) // first: garbage → null
      .mockResolvedValueOnce(VALID_WORLD_RAW) // second: valid

    const resolver = new WorldResolver(fetcher)

    const first = await resolver.resolve('wrld_abc')
    const second = await resolver.resolve('wrld_abc')

    expect(first).toBeNull()
    expect(second).toEqual(VALID_WORLD_META)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  // ── shortName support ────────────────────────────────────────────────────────

  it('includes shortName in WorldMeta when present in response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...VALID_WORLD_RAW,
      shortName: 'example-world'
    })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.shortName).toBe('example-world')
  })

  it('sets shortName to null when absent from response', async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: 'Test', capacity: 10 })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.shortName).toBeNull()
  })

  // ── 2026-07 audit W4: enrichment fields must not kill the world ─────────────
  // api-volatility.md promises "missing capacity → unknown"; before this fix a
  // missing/garbage capacity failed the WHOLE parse and nulled name+thumbnail.

  it('resolves name+thumbnail when capacity is absent (capacity → null)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      name: 'The Great Pug',
      thumbnailImageUrl: 'https://example.com/pug.jpg'
    })
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toEqual({
      name: 'The Great Pug',
      thumbnailUrl: 'https://example.com/pug.jpg',
      capacity: null,
      shortName: null
    })
  })

  it('degrades a garbage capacity (wrong type) to null instead of nulling the world', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ...VALID_WORLD_RAW, capacity: 'lots' })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.name).toBe('The Great Pug')
    expect(result?.capacity).toBeNull()
  })

  it('degrades a garbage thumbnailImageUrl (wrong type) to null, keeping the name', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ...VALID_WORLD_RAW, thumbnailImageUrl: 42 })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.name).toBe('The Great Pug')
    expect(result?.thumbnailUrl).toBeNull()
  })

  it('degrades a garbage shortName (wrong type) to null, keeping the name', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ...VALID_WORLD_RAW, shortName: 123 })
    const resolver = new WorldResolver(fetcher)
    const result = await resolver.resolve('wrld_abc')
    expect(result?.name).toBe('The Great Pug')
    expect(result?.shortName).toBeNull()
  })

  it('still returns null when name is missing (the one critical field)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ thumbnailImageUrl: 'x.jpg', capacity: 10 })
    const resolver = new WorldResolver(fetcher)
    expect(await resolver.resolve('wrld_abc')).toBeNull()
  })

  // ── worldShortLink helper ────────────────────────────────────────────────────

  it('worldShortLink converts shortName to https://vrch.at/ link', () => {
    expect(worldShortLink('example-world')).toBe('https://vrch.at/example-world')
  })

  it('worldShortLink returns null when shortName is null', () => {
    expect(worldShortLink(null)).toBeNull()
  })
})
