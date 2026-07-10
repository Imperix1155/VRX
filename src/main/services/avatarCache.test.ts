import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CACHE_MAX_ENTRIES,
  AVATAR_FETCH_MAX_CONCURRENCY,
  AVATAR_MAX_BODY_BYTES,
  AVATAR_MAX_URL_LENGTH,
  AvatarCache
} from './avatarCache'

const ALLOWED_URL = 'https://files.vrchat.cloud/avatar/file_1.png'

function imageResponse(body: BodyInit = 'avatar', headers?: HeadersInit): Response {
  return new Response(body, { headers: { 'Content-Type': 'image/png', ...headers } })
}

describe('AvatarCache', () => {
  it('rejects invalid, non-allowlisted, and overlong URLs without fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get('http://files.vrchat.cloud/avatar.png')).resolves.toBeNull()
    await expect(cache.get('https://files.vrchat.cloud.evil.test/avatar.png')).resolves.toBeNull()
    await expect(cache.get('https://127.0.0.1/avatar.png')).resolves.toBeNull()
    await expect(
      cache.get(`https://files.vrchat.cloud/${'a'.repeat(AVATAR_MAX_URL_LENGTH)}`)
    ).resolves.toBeNull()
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

  it('deduplicates fragment variants under one canonical fetch key', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        })
    )
    const cache = new AvatarCache({ fetchFn })

    const first = cache.get(`${ALLOWED_URL}#first`)
    const second = cache.get(`${ALLOWED_URL}#second`)
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce())
    resolveResponse?.(imageResponse())

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.stringMatching(/^data:image\/png;base64,/),
      expect.stringMatching(/^data:image\/png;base64,/)
    ])
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith(ALLOWED_URL, expect.any(Object))
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

  it('expires positive cache entries using the injected clock', async () => {
    let now = 1_000
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse())
    const cache = new AvatarCache({ fetchFn, now: () => now, positiveCacheMs: 50 })

    await cache.get(ALLOWED_URL)
    now += 50
    await cache.get(ALLOWED_URL)

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each(['text/html', 'application/octet-stream'])(
    'rejects the disallowed %s MIME type',
    async (contentType) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('not an image', { headers: { 'Content-Type': contentType } })
        )
      const cache = new AvatarCache({ fetchFn })

      await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    }
  )

  it('rejects an oversized Content-Length before reading the body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel
    })
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        imageResponse(body, { 'Content-Length': String(AVATAR_MAX_BODY_BYTES + 1) })
      )
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('aborts a streamed body as soon as actual bytes exceed the cap', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(AVATAR_MAX_BODY_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel
    })
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse(body))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(ALLOWED_URL)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it(`never runs more than ${AVATAR_FETCH_MAX_CONCURRENCY} fetches at once`, async () => {
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          releases.push(() => {
            active -= 1
            resolve(imageResponse())
          })
        })
    )
    const cache = new AvatarCache({ fetchFn })
    const requests = Array.from({ length: 10 }, (_, index) =>
      cache.get(`https://files.abinteractive.net/avatars/concurrent-${index}.png`)
    )

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4))
    releases.splice(0, 4).forEach((release) => release())
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8))
    releases.splice(0, 4).forEach((release) => release())
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(10))
    releases.splice(0).forEach((release) => release())
    await Promise.all(requests)

    expect(maxActive).toBe(AVATAR_FETCH_MAX_CONCURRENCY)
    expect(fetchFn).toHaveBeenCalledTimes(10)
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
