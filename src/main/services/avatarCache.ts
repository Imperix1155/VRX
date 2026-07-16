import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './adapters/VrcApiClient'

export const AVATAR_ALLOWED_HOSTS = new Set([
  'files.vrchat.cloud',
  'api.vrchat.cloud',
  'assets.vrchat.com',
  'files.abinteractive.net',
  // CVR's live avatar CDN (VRX-202): real rosters serve `imageUrl` from
  // files.abidata.io (verified against CVRX api_cvr_http.js + chilloutvr_rs).
  'files.abidata.io',
  // CVR's CURRENT roster CDN (VRX-62, live-verified 2026-07-16): a real
  // GET /friends served all 166 imageUrls from files.chilloutvr.net — the
  // abidata host above is retained for older/legacy URLs.
  'files.chilloutvr.net'
])
/** The only host that ever receives the VRChat auth cookie (VRX-202). */
export const AVATAR_COOKIE_HOST = 'api.vrchat.cloud'
/**
 * VRChat's image endpoint answers with a 302 to a signed CDN URL, so one
 * delegated hop is the NORMAL path; 2 leaves headroom without allowing chains.
 */
export const AVATAR_MAX_REDIRECTS = 2
export const AVATAR_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif'
])
export const AVATAR_CACHE_MAX_ENTRIES = 200
export const AVATAR_FETCH_MAX_CONCURRENCY = 4
export const AVATAR_MAX_BODY_BYTES = 3 * 1024 * 1024
export const AVATAR_MAX_URL_LENGTH = 2048
export const AVATAR_NEGATIVE_CACHE_MS = 30_000
export const AVATAR_POSITIVE_CACHE_MS = 60 * 60 * 1000

interface CacheEntry {
  dataUrl: string | null
  expiresAt: number
}

interface AvatarCacheOptions {
  fetchFn?: typeof fetch
  now?: () => number
  maxEntries?: number
  negativeCacheMs?: number
  positiveCacheMs?: number
  maxConcurrency?: number
  /**
   * Returns the CURRENT VRChat auth Cookie header value, or null when logged
   * out (VRX-202: the image endpoint 401s unauthenticated). Read at fetch time
   * so rotation/logout apply immediately. Sent ONLY to AVATAR_COOKIE_HOST —
   * never forwarded on redirects. Never log its value.
   */
  vrcCookieProvider?: () => string | null
}

function parseAllowedAvatarUrl(value: string): URL | null {
  if (value.length > AVATAR_MAX_URL_LENGTH) return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      // WHATWG canonicalization removes default :443; reject only non-default ports.
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      !AVATAR_ALLOWED_HOSTS.has(url.hostname)
    ) {
      return null
    }
    url.hash = ''
    return url
  } catch {
    return null
  }
}

const IPV4_LITERAL_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/** Reject IP-literal and localhost redirect targets (SSRF hardening, VRX-202). */
function isForbiddenRedirectHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.includes(':') || // WHATWG keeps IPv6 literals bracket-stripped with colons
    IPV4_LITERAL_RE.test(hostname)
  )
}

/**
 * Session-only avatar image cache. This deliberately does not use a platform
 * adapter: image traffic has its own cache/dedupe lifecycle and must not consume
 * either API adapter's rate-limit queue.
 */
export class AvatarCache {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly negativeCacheMs: number
  private readonly positiveCacheMs: number
  private readonly maxConcurrency: number
  private activeFetches = 0
  private readonly fetchWaiters: Array<() => void> = []
  private vrcCookieProvider: (() => string | null) | null

  constructor(options: AvatarCacheOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? AVATAR_CACHE_MAX_ENTRIES
    this.negativeCacheMs = options.negativeCacheMs ?? AVATAR_NEGATIVE_CACHE_MS
    this.positiveCacheMs = options.positiveCacheMs ?? AVATAR_POSITIVE_CACHE_MS
    this.maxConcurrency = options.maxConcurrency ?? AVATAR_FETCH_MAX_CONCURRENCY
    this.vrcCookieProvider = options.vrcCookieProvider ?? null
  }

  /** Late wiring for the module singleton: index.ts registers the adapter's
   *  cookie accessor after the adapters are constructed (VRX-202). */
  setVrcCookieProvider(provider: (() => string | null) | null): void {
    this.vrcCookieProvider = provider
  }

  /**
   * Drop cached FAILURES (auth-boundary hook, VRX-202/Codex): a fetch that
   * 401'd around a login/logout/rotation would otherwise pin the placeholder
   * for the negative TTL. Positive entries stay — images are auth-invariant.
   * Residual (accepted): a fetch IN FLIGHT across the boundary can still write
   * one stale failure after the clear; it self-heals within the 30s TTL.
   */
  clearNegativeEntries(): void {
    for (const [url, entry] of this.cache) {
      if (entry.dataUrl === null) this.cache.delete(url)
    }
  }

  get(value: string): Promise<string | null> {
    const parsed = parseAllowedAvatarUrl(value)
    if (!parsed) return Promise.resolve(null)
    const url = parsed.href

    const cached = this.cache.get(url)
    if (cached) {
      if (cached.expiresAt > this.now()) {
        this.cache.delete(url)
        this.cache.set(url, cached)
        return Promise.resolve(cached.dataUrl)
      }
      this.cache.delete(url)
    }

    const pending = this.inFlight.get(url)
    if (pending) return pending

    const request = this.fetchAndCache(url)
    this.inFlight.set(url, request)
    void request.finally(() => this.inFlight.delete(url))
    return request
  }

  private async fetchAndCache(url: string): Promise<string | null> {
    await this.acquireFetchSlot()
    let dataUrl: string | null = null
    try {
      dataUrl = await this.fetchAvatar(url)
    } catch {
      // Avatar failures are intentionally non-fatal; the renderer keeps the
      // initial-letter fallback and the short negative cache prevents hammering.
    } finally {
      this.releaseFetchSlot()
    }

    this.cache.set(url, {
      dataUrl,
      expiresAt: this.now() + (dataUrl === null ? this.negativeCacheMs : this.positiveCacheMs)
    })
    this.evictOldestEntries()
    return dataUrl
  }

  /**
   * Fetch the image, following the VRChat image endpoint's redirect shape
   * (VRX-202): the API host requires the auth cookie and answers 302 with a
   * signed CDN URL. Redirect rules — every one load-bearing:
   *  - ONLY the API host (AVATAR_COOKIE_HOST) may issue a followed redirect —
   *    the one host that legitimately 302s (Codex review tightening: CDN hosts
   *    serve images directly, so giving them delegation was pure SSRF surface).
   *    The TARGET is not allowlist-checked (VRChat rotates signed-CDN hosts
   *    freely), but it cannot redirect again, which kills chains.
   *  - Targets must be bare https (no port, no credentials) on a NAMED public
   *    host (IP literals and localhost names rejected). Residual: a DNS name
   *    resolving privately is only reachable via an api.vrchat.cloud open
   *    redirect — accepted, documented.
   *  - The auth cookie is attached ONLY when the CURRENT hop is the API host —
   *    it is never forwarded to a redirect target.
   *  - At most AVATAR_MAX_REDIRECTS hops.
   */
  private async fetchAvatar(url: string): Promise<string | null> {
    let target = new URL(url)
    for (let hop = 0; hop <= AVATAR_MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = { 'User-Agent': VRC_USER_AGENT }
      if (target.hostname === AVATAR_COOKIE_HOST) {
        const cookie = this.vrcCookieProvider?.() ?? null
        if (cookie !== null) headers['Cookie'] = cookie
      }
      const controller = new AbortController()
      const response = await this.fetchFn(target.href, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(API_TIMEOUT_MS)])
      })

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        if (target.hostname !== AVATAR_COOKIE_HOST) return null
        const location = response.headers.get('location')
        if (location === null) return null
        let next: URL
        try {
          next = new URL(location, target)
        } catch {
          return null
        }
        if (
          next.protocol !== 'https:' ||
          next.port !== '' ||
          next.username !== '' ||
          next.password !== '' ||
          isForbiddenRedirectHost(next.hostname)
        ) {
          return null
        }
        next.hash = ''
        target = next
        continue
      }

      return await this.readImageBody(response, controller)
    }
    return null
  }

  private async readImageBody(
    response: Response,
    controller: AbortController
  ): Promise<string | null> {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (!response.ok || !contentType || !AVATAR_ALLOWED_MIME_TYPES.has(contentType)) {
      controller.abort()
      await response.body?.cancel()
      return null
    }

    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null) {
      const length = Number(declaredLength)
      if (!Number.isFinite(length) || length < 0 || length > AVATAR_MAX_BODY_BYTES) {
        controller.abort()
        await response.body?.cancel()
        return null
      }
    }

    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > AVATAR_MAX_BODY_BYTES) {
        controller.abort()
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }

    // Decoded dimensions/frame-count validation is intentionally excluded: these
    // exact formats come from first-party allowlisted CDNs, so decoder plumbing is
    // disproportionate to the remaining decompression-bomb risk for this feature.
    const bytes = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalBytes
    )
    return `data:${contentType};base64,${bytes.toString('base64')}`
  }

  private acquireFetchSlot(): Promise<void> {
    if (this.activeFetches < this.maxConcurrency) {
      this.activeFetches += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.fetchWaiters.push(() => {
        this.activeFetches += 1
        resolve()
      })
    })
  }

  private releaseFetchSlot(): void {
    this.activeFetches -= 1
    this.fetchWaiters.shift()?.()
  }

  private evictOldestEntries(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.cache.delete(oldest)
    }
  }
}

export const avatarCache = new AvatarCache()
