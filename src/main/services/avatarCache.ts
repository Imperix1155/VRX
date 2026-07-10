import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './adapters/VrcApiClient'

export const AVATAR_ALLOWED_HOSTS = new Set([
  'files.vrchat.cloud',
  'api.vrchat.cloud',
  'assets.vrchat.com',
  'files.abinteractive.net'
])
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

  constructor(options: AvatarCacheOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? AVATAR_CACHE_MAX_ENTRIES
    this.negativeCacheMs = options.negativeCacheMs ?? AVATAR_NEGATIVE_CACHE_MS
    this.positiveCacheMs = options.positiveCacheMs ?? AVATAR_POSITIVE_CACHE_MS
    this.maxConcurrency = options.maxConcurrency ?? AVATAR_FETCH_MAX_CONCURRENCY
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

  private async fetchAvatar(url: string): Promise<string | null> {
    const controller = new AbortController()
    const response = await this.fetchFn(url, {
      headers: { 'User-Agent': VRC_USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(API_TIMEOUT_MS)])
    })
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
