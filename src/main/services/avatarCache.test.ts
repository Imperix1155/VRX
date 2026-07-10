import { describe, expect, it, vi } from 'vitest'
import { AVATAR_CACHE_MAX_ENTRIES, AvatarCache } from './avatarCache'

const ALLOWED_URL = 'https://files.vrchat.cloud/avatar/file_1.png'

function imageResponse(body = 'avatar'): Response {
  return new Response(body, { headers: { 'Content-Type': 'image/png' } })
}

describe('AvatarCache', () => {
  it('rejects non-HTTPS and non-allowlisted hosts without fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get('http://files.vrchat.cloud/avatar.png')).resolves.toBeNull()
    await expect(cache.get('https://files.vrchat.cloud.evil.test/avatar.png')).resolves.toBeNull()
    await expect(cache.get('https://127.0.0.1/avatar.png')).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('serves a cache hit with a single fetch', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse())
    const cache = new AvatarCache({ fetchFn })

    const first = await cache.get(ALLOWED_URL)
    const second = await cache.get(ALLOWED_URL)

    expect(first).toMatch(/^data:image\/png;base64,/)
    expect(second).toBe(first)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent requests for the same URL', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        })
    )
    const cache = new AvatarCache({ fetchFn })

    const first = cache.get(ALLOWED_URL)
    const second = cache.get(ALLOWED_URL)
    resolveResponse?.(imageResponse())

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.stringMatching(/^data:image\/png;base64,/),
      expect.stringMatching(/^data:image\/png;base64,/)
    ])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('returns null and briefly negative-caches failures', async () => {
    let now = 1_000
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const cache = new AvatarCache({ fetchFn, now: () => now, negativeCacheMs: 50 })

    await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    now += 51
    await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it(`evicts the least-recently-used entry above the ${AVATAR_CACHE_MAX_ENTRIES}-entry cap`, async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse())
    const cache = new AvatarCache({ fetchFn })
    const urls = Array.from(
      { length: AVATAR_CACHE_MAX_ENTRIES + 1 },
      (_, index) => `https://files.abinteractive.net/avatars/${index}.png`
    )

    for (const url of urls) await cache.get(url)
    await cache.get(urls[0]!)

    expect(fetchFn).toHaveBeenCalledTimes(AVATAR_CACHE_MAX_ENTRIES + 2)
  })
})
