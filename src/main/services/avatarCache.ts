import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './adapters/VrcApiClient'

export const AVATAR_ALLOWED_HOSTS = new Set([
  'files.vrchat.cloud',
  'api.vrchat.cloud',
  'assets.vrchat.com',
  'files.abinteractive.net'
])
export const AVATAR_CACHE_MAX_ENTRIES = 200
export const AVATAR_NEGATIVE_CACHE_MS = 30_000

interface CacheEntry {
  dataUrl: string | null
  expiresAt: number
}

interface AvatarCacheOptions {
  fetchFn?: typeof fetch
  now?: () => number
  maxEntries?: number
  negativeCacheMs?: number
}

function isAllowedAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      AVATAR_ALLOWED_HOSTS.has(url.hostname)
    )
  } catch {
    return false
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

  constructor(options: AvatarCacheOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? AVATAR_CACHE_MAX_ENTRIES
    this.negativeCacheMs = options.negativeCacheMs ?? AVATAR_NEGATIVE_CACHE_MS
  }

  get(url: string): Promise<string | null> {
    if (!isAllowedAvatarUrl(url)) return Promise.resolve(null)

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
    let dataUrl: string | null = null
    try {
      const response = await this.fetchFn(url, {
        headers: { 'User-Agent': VRC_USER_AGENT },
        redirect: 'error',
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      })
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
      if (response.ok && contentType?.startsWith('image/')) {
        const bytes = Buffer.from(await response.arrayBuffer())
        dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`
      }
    } catch {
      // Avatar failures are intentionally non-fatal; the renderer keeps the
      // initial-letter fallback and the short negative cache prevents hammering.
    }

    this.cache.set(url, {
      dataUrl,
      expiresAt: dataUrl === null ? this.now() + this.negativeCacheMs : Number.POSITIVE_INFINITY
    })
    this.evictOldestEntries()
    return dataUrl
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
