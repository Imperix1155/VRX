import { describe, expect, it, vi } from 'vitest'
import { WORLD_CACHE_TTL_MS } from '@shared/constants'
import { WorldResolver, WORLD_NEGATIVE_CACHE_TTL_MS } from './WorldResolver'
import { AuthError } from '../errors'

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

  it('peek returns only fresh cached metadata without fetching', async () => {
    let now = 1_000
    const fetcher = vi.fn().mockResolvedValue(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher, () => now)
    const peekable = resolver as unknown as {
      peek(worldId: string | null): typeof VALID_WORLD_META | null | undefined
    }

    expect(peekable.peek('wrld_abc')).toBeUndefined()
    await resolver.resolve('wrld_abc')
    expect(peekable.peek('wrld_abc')).toEqual(VALID_WORLD_META)
    expect(fetcher).toHaveBeenCalledOnce()

    now += WORLD_CACHE_TTL_MS
    expect(peekable.peek('wrld_abc')).toBeUndefined()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('clear drops an account-scoped negative cache entry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ totally: 'wrong' })
      .mockResolvedValueOnce(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher)

    expect(await resolver.resolve('wrld_abc')).toBeNull()
    resolver.clear()

    await expect(resolver.resolve('wrld_abc')).resolves.toEqual(VALID_WORLD_META)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not let a pre-clear response overwrite the replacement generation cache', async () => {
    let releaseOld!: (value: unknown) => void
    const oldResponse = new Promise<unknown>((resolve) => {
      releaseOld = resolve
    })
    const replacementRaw = {
      ...VALID_WORLD_RAW,
      name: 'Replacement Account World'
    }
    const fetcher = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValueOnce(replacementRaw)
    const resolver = new WorldResolver(fetcher)

    const oldResolve = resolver.resolve('wrld_abc')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    resolver.clear()
    await expect(resolver.resolve('wrld_abc')).resolves.toMatchObject({
      name: 'Replacement Account World'
    })

    releaseOld({ ...VALID_WORLD_RAW, name: 'Old Account World' })
    await expect(oldResolve).resolves.toMatchObject({ name: 'Old Account World' })
    expect(resolver.peek('wrld_abc')).toMatchObject({ name: 'Replacement Account World' })
  })

  it('keeps the newest same-generation response in cache when an older request settles last', async () => {
    let releaseOlder!: (value: unknown) => void
    const olderResponse = new Promise<unknown>((resolve) => {
      releaseOlder = resolve
    })
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(olderResponse)
      .mockResolvedValueOnce({ ...VALID_WORLD_RAW, name: 'Newer World' })
    const resolver = new WorldResolver(fetcher)

    const olderResolve = resolver.resolve('wrld_abc')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await expect(resolver.resolve('wrld_abc')).resolves.toMatchObject({ name: 'Newer World' })

    releaseOlder({ ...VALID_WORLD_RAW, name: 'Older World' })
    await expect(olderResolve).resolves.toMatchObject({ name: 'Older World' })
    expect(resolver.peek('wrld_abc')).toMatchObject({ name: 'Newer World' })
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

  it('RETHROWS an AuthError (dead session) instead of degrading to null (VRX-197, Codex)', async () => {
    // A dead cookie mid-enrichment must propagate so VrcAdapter.getFriends can
    // emit auth-invalidated — unlike every other failure, which degrades to null.
    const fetcher = vi.fn().mockRejectedValue(new AuthError('session expired'))
    const resolver = new WorldResolver(fetcher)
    await expect(resolver.resolve('wrld_abc')).rejects.toBeInstanceOf(AuthError)
  })

  it('negative-caches a garbage response shape and retries only after the TTL', async () => {
    let now = 0
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ totally: 'wrong' })
      .mockResolvedValueOnce(VALID_WORLD_RAW)
    const resolver = new WorldResolver(fetcher, () => now)

    expect(await resolver.resolve('wrld_abc')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    now = WORLD_NEGATIVE_CACHE_TTL_MS - 1
    expect(await resolver.resolve('wrld_abc')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    now = WORLD_NEGATIVE_CACHE_TTL_MS
    expect(await resolver.resolve('wrld_abc')).toEqual(VALID_WORLD_META)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('peek returns null for a negative-cached failure within the TTL', async () => {
    let now = 0
    const fetcher = vi.fn().mockResolvedValue({ totally: 'wrong' })
    const resolver = new WorldResolver(fetcher, () => now)
    const peekable = resolver as unknown as {
      peek(worldId: string | null): typeof VALID_WORLD_META | null | undefined
    }

    await resolver.resolve('wrld_abc')
    expect(peekable.peek('wrld_abc')).toBeNull()

    now = WORLD_NEGATIVE_CACHE_TTL_MS
    expect(peekable.peek('wrld_abc')).toBeUndefined()
  })

  it('caches a null result for the negative TTL, then retries', async () => {
    let now = 0
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('404 not found')) // first: failure → null
      .mockResolvedValueOnce(VALID_WORLD_RAW) // second: valid, after TTL

    const resolver = new WorldResolver(fetcher, () => now)

    const first = await resolver.resolve('wrld_abc')
    expect(first).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Within the negative window the cached null is returned without a fetch.
    now = WORLD_NEGATIVE_CACHE_TTL_MS - 1
    const second = await resolver.resolve('wrld_abc')
    expect(second).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    // After the window expires the next call retries.
    now = WORLD_NEGATIVE_CACHE_TTL_MS
    const third = await resolver.resolve('wrld_abc')
    expect(third).toEqual(VALID_WORLD_META)
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
})
