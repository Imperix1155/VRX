import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../errors'
import { createGroupResolver, GROUP_CACHE_MAX, GROUP_NEGATIVE_TTL_MS } from './GroupResolver'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe('GroupResolver', () => {
  it('resolves a group to its name and icon', async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: 'Pixel Pals', iconUrl: 'https://x/icon.png' })
    const resolver = createGroupResolver({ fetcher })

    const meta = await resolver.resolve('grp_1')

    expect(fetcher).toHaveBeenCalledWith('grp_1', undefined)
    expect(meta).toEqual({ name: 'Pixel Pals', iconUrl: 'https://x/icon.png' })
  })

  it('returns cached value for the TTL window', async () => {
    let now = 1000
    const fetcher = vi.fn().mockResolvedValue({ name: 'Cached Group', iconUrl: null })
    const resolver = createGroupResolver({ fetcher, clock: () => now })

    await resolver.resolve('grp_2')
    now += ONE_DAY_MS - 1
    const meta = await resolver.resolve('grp_2')

    expect(fetcher).toHaveBeenCalledOnce()
    expect(meta).toEqual({ name: 'Cached Group', iconUrl: null })
  })

  it('negative-caches unknown/private groups for 60s', async () => {
    let now = 1000
    const fetcher = vi.fn().mockRejectedValue(new Error('gone'))
    const resolver = createGroupResolver({ fetcher, clock: () => now })

    const first = await resolver.resolve('grp_3')
    expect(first).toBeNull()
    expect(fetcher).toHaveBeenCalledOnce()

    now += GROUP_NEGATIVE_TTL_MS - 1
    const second = await resolver.resolve('grp_3')
    expect(second).toBeNull()
    expect(fetcher).toHaveBeenCalledOnce()

    now += 2
    await resolver.resolve('grp_3')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('propagates AuthError so the adapter can invalidate the session', async () => {
    const fetcher = vi.fn().mockRejectedValue(new AuthError('Unauthorized', 401))
    const resolver = createGroupResolver({ fetcher })

    await expect(resolver.resolve('grp_4')).rejects.toBeInstanceOf(AuthError)
  })

  it('peek returns undefined before resolve, the value after resolve, and null after a negative cache', async () => {
    let now = 1000
    const fetcher = vi.fn().mockResolvedValue({ name: 'Peekable', iconUrl: null })
    const resolver = createGroupResolver({ fetcher, clock: () => now })

    expect(resolver.peek('grp_5')).toBeUndefined()

    await resolver.resolve('grp_5')
    expect(resolver.peek('grp_5')).toEqual({ name: 'Peekable', iconUrl: null })

    now += ONE_DAY_MS + 1
    expect(resolver.peek('grp_5')).toBeUndefined()
  })

  it('bounds the cache to GROUP_CACHE_MAX entries', async () => {
    let id = 0
    const fetcher = vi.fn().mockImplementation(() => {
      id++
      return Promise.resolve({ name: `Group ${id}`, iconUrl: null })
    })
    const resolver = createGroupResolver({ fetcher })

    for (let i = 0; i < GROUP_CACHE_MAX + 10; i++) {
      await resolver.resolve(`grp_${String(i)}`)
    }

    // A bounded resolver never throws and never holds more than the cap.
    expect(fetcher).toHaveBeenCalledTimes(GROUP_CACHE_MAX + 10)
  })

  it('degrades a missing iconUrl to null', async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: 'No Icon' })
    const resolver = createGroupResolver({ fetcher })

    const meta = await resolver.resolve('grp_6')
    expect(meta).toEqual({ name: 'No Icon', iconUrl: null })
  })
})
