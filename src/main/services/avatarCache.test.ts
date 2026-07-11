import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CACHE_MAX_ENTRIES,
  AVATAR_FETCH_MAX_CONCURRENCY,
  AVATAR_MAX_BODY_BYTES,
  AVATAR_MAX_REDIRECTS,
  AVATAR_MAX_URL_LENGTH,
  AvatarCache
} from './avatarCache'

const ALLOWED_URL = 'https://files.vrchat.cloud/avatar/file_1.png'

function imageResponse(body: BodyInit = 'avatar', headers?: HeadersInit): Response {
  return new Response(body, { headers: { 'Content-Type': 'image/png', ...headers } })
}

describe('AvatarCache', () => {
  // ── VRX-202: the REAL production URL shapes ─────────────────────────────────
  // VRChat: api.vrchat.cloud/api/1/image/... — needs the auth cookie, answers
  // 302 to a signed CDN URL. CVR: files.abidata.io — public, direct 200.

  const VRC_IMAGE_URL = 'https://api.vrchat.cloud/api/1/image/file_0000/1/256'
  const CDN_URL = 'https://d348imysud55la.cloudfront.net/thumbnails/file_0000.256.png'

  function redirectResponse(location: string): Response {
    return new Response(null, { status: 302, headers: { Location: location } })
  }

  it('sends the auth cookie to api.vrchat.cloud, follows the 302, and never forwards the cookie', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse(CDN_URL))
      .mockResolvedValueOnce(imageResponse())
    const cache = new AvatarCache({ fetchFn, vrcCookieProvider: () => 'auth=authcookie_test' })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toMatch(/^data:image\/png;base64,/)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0]?.[0]).toBe(VRC_IMAGE_URL)
    expect((fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['Cookie']).toBe(
      'auth=authcookie_test'
    )
    expect(fetchFn.mock.calls[1]?.[0]).toBe(CDN_URL)
    expect(
      (fetchFn.mock.calls[1]?.[1]?.headers as Record<string, string>)['Cookie']
    ).toBeUndefined()
  })

  it('fetches api.vrchat.cloud without a Cookie header when logged out (provider null)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    expect(
      (fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['Cookie']
    ).toBeUndefined()
  })

  it('fetches files.abidata.io directly with no cookie (CVR live CDN)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse())
    const cache = new AvatarCache({ fetchFn, vrcCookieProvider: () => 'auth=authcookie_test' })

    await expect(cache.get('https://files.abidata.io/user_images/00-0000.png')).resolves.toMatch(
      /^data:image\/png;base64,/
    )
    expect(
      (fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['Cookie']
    ).toBeUndefined()
  })

  it('refuses a redirect ISSUED by any host but api.vrchat.cloud (no CDN chains)', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse(CDN_URL))
      .mockResolvedValueOnce(redirectResponse('https://files.vrchat.cloud/x.png'))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['http downgrade', 'http://files.vrchat.cloud/x.png'],
    ['explicit port', 'https://files.vrchat.cloud:8443/x.png'],
    ['embedded credentials', 'https://user:pw@files.vrchat.cloud/x.png']
  ])('refuses a redirect target with %s', async (_name, location) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(redirectResponse(location))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect issued by an ALLOWLISTED CDN host (only the API host delegates)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(redirectResponse(CDN_URL))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get('https://files.abidata.io/user_images/00-0000.png')).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['IPv4 literal', 'https://10.0.0.7/x.png'],
    ['IPv6 literal', 'https://[::1]/x.png'],
    ['localhost', 'https://localhost/x.png'],
    ['.localhost subdomain', 'https://evil.localhost/x.png']
  ])('refuses a redirect target that is a %s (SSRF hardening)', async (_name, location) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(redirectResponse(location))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('withholds the cookie from sibling VRChat hosts (exact-host attach, not suffix match)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(imageResponse())
    const cache = new AvatarCache({ fetchFn, vrcCookieProvider: () => 'auth=authcookie_test' })

    await expect(cache.get('https://files.vrchat.cloud/avatar/file_2.png')).resolves.toMatch(
      /^data:image\/png;base64,/
    )
    expect(
      (fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['Cookie']
    ).toBeUndefined()
  })

  it('clearNegativeEntries drops cached failures but keeps cached images (auth boundary)', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(redirectResponse(CDN_URL))
      .mockResolvedValueOnce(imageResponse())
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    const positive = await cache.get('https://files.abidata.io/user_images/00-0000.png')
    expect(positive).toMatch(/^data:image\/png;base64,/)

    cache.clearNegativeEntries()

    // The failure refetches (now succeeding via the 302 path); the image stays cached.
    await expect(cache.get(VRC_IMAGE_URL)).resolves.toMatch(/^data:image\/png;base64,/)
    await expect(cache.get('https://files.abidata.io/user_images/00-0000.png')).resolves.toBe(
      positive
    )
    expect(fetchFn).toHaveBeenCalledTimes(4)
  })

  it('gives up after the redirect cap instead of looping', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirectResponse('https://api.vrchat.cloud/api/1/image/file_0000/1/256'))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(AVATAR_MAX_REDIRECTS + 1)
  })

  it('enforces the MIME and size caps on the redirect TARGET response', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse(CDN_URL))
      .mockResolvedValueOnce(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    const cache = new AvatarCache({ fetchFn })

    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBeNull()
  })

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
