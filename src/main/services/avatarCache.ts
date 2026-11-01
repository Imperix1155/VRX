import {
  ApiAdmissionController,
  API_MAX_PENDING_ADMISSIONS
} from './adapters/ApiAdmissionController'
import { RequestQueueFullError, RequestCancelledError } from './adapters/errors'
import { assertRequestLease, type AvatarRequestLease } from './adapters/RequestLease'
import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './adapters/VrcApiClient'
import type { ImageDiskStore, StoredImage } from './imageDiskStore'

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
/**
 * Aggregate budget for retained data URLs (#370). Measured in data-URL
 * characters (base64 is ASCII, so ~1 byte each in V8). Without it, 200 entries
 * of up to 3 MiB (≈4 MiB as base64) could retain ~800 MiB in main.
 */
export const AVATAR_CACHE_MAX_BYTES = 48 * 1024 * 1024
export const AVATAR_FETCH_MAX_CONCURRENCY = 4
export const AVATAR_MAX_BODY_BYTES = 3 * 1024 * 1024
export const AVATAR_MAX_URL_LENGTH = 2048
export const AVATAR_NEGATIVE_CACHE_MS = 30_000
export const AVATAR_POSITIVE_CACHE_MS = 60 * 60 * 1000

/**
 * `avatar` asks for a small copy sized for the round friend pictures (at most
 * 64 px on screen). `picture` is a card-sized copy for world and avatar
 * pictures, reached through `getPicture`, which also asks VRChat for the full
 * picture instead of its small thumbnail. Everything else uses `original`.
 */
export type ImageRendition = 'original' | 'avatar' | 'picture'

/** How long a full picture VRChat refused is skipped in favor of its thumbnail. */
export const PICTURE_REFUSED_MS = 60 * 60 * 1000
export const PICTURE_REFUSED_MAX_ENTRIES = 500
/**
 * Refused full pictures in a row before `getPicture` goes straight to
 * thumbnails for `PICTURE_REFUSED_MS`. If VRChat ever stops serving full
 * pictures in a usable form, this caps the wasted requests at a handful.
 */
export const PICTURE_REFUSED_STREAK_LIMIT = 3

const VRC_SIZED_IMAGE_RE =
  /^https:\/\/api\.vrchat\.cloud\/api\/1\/image\/(file_[A-Za-z0-9-]+)\/(\d+)\/(\d+)\/?$/

/** Sized VRChat images at least this wide are already sharp enough for a card. */
export const VRC_SHARP_IMAGE_WIDTH = 1024

const VRC_FULL_PICTURE_RE =
  /^https:\/\/api\.vrchat\.cloud\/api\/1\/file\/file_[A-Za-z0-9-]+\/\d+\/file$/

/**
 * The full VRChat picture behind a sized thumbnail, or null when there is none.
 *
 * VRChat lists worlds and avatars with a `thumbnailImageUrl` such as
 * `/api/1/image/<file>/<version>/256`: a 256 px wide copy, which turns blurry
 * once a card is wider than that (owner, 2026-11-01). The same file's
 * `/api/1/file/<file>/<version>/file` is the uploaded picture (usually 800 or
 * 1,200 px wide). It is one request either way, so the picture costs no extra
 * API call; only its body is bigger, and `picture` keeps a smaller copy.
 */
export function vrcFullPictureUrl(value: string): string | null {
  const match = VRC_SIZED_IMAGE_RE.exec(value)
  // A width of 1,024 px or more was picked on purpose (group banners); keep it.
  if (match === null || Number(match[3]) >= VRC_SHARP_IMAGE_WIDTH) return null
  return `https://api.vrchat.cloud/api/1/file/${match[1]}/${match[2]}/file`
}

/**
 * Builds the small `avatar` copy of a downloaded image, or returns null to keep
 * the original (unsupported format, already small, or no saving).
 */
export type AvatarRenditionMaker = (image: StoredImage) => StoredImage | null

/**
 * Cache key of a rendition. URLs are stored without a fragment, so the suffix
 * cannot collide with a real URL, and the key still parses as that URL for
 * host checks.
 */
const AVATAR_RENDITION_KEY_SUFFIX = '#vrx-avatar'
const PICTURE_RENDITION_KEY_SUFFIX = '#vrx-picture'

function renditionKey(url: string, rendition: ImageRendition): string {
  if (rendition === 'avatar') return url + AVATAR_RENDITION_KEY_SUFFIX
  if (rendition === 'picture') return url + PICTURE_RENDITION_KEY_SUFFIX
  return url
}

interface CacheEntry {
  dataUrl: string | null
  expiresAt: number
}

interface AvatarCacheOptions {
  apiAdmission?: ApiAdmissionController
  fetchFn?: typeof fetch
  now?: () => number
  maxEntries?: number
  maxBytes?: number
  negativeCacheMs?: number
  positiveCacheMs?: number
  maxConcurrency?: number
  /**
   * Capture one account lease when the image operation begins. A null lease
   * suppresses API images until the session is durable. Its cookie accessor
   * runs only after admission, and never for CDN hosts. Never log its value.
   */
  vrcSessionProvider?: () => AvatarRequestLease | null
  /**
   * Optional disk tier for API-host images only (see imageDiskStore.ts). A
   * stored image is served without a request, even before the VRChat session
   * is ready; only a lease-current network result is written back.
   */
  diskStore?: ImageDiskStore | null
  /** Optional builder for `avatar` renditions; without it they are the original. */
  makeAvatarRendition?: AvatarRenditionMaker | null
  /** Optional builder for `picture` renditions; without it they are the original. */
  makePictureRendition?: AvatarRenditionMaker | null
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
 * Session-only image cache. API hops share the platform admission controller;
 * CDN body transfers retain their own bounded concurrency and host cooldowns.
 */
export class AvatarCache {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private readonly inFlightLeases = new Map<string, AvatarRequestLease>()
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private cachedBytes = 0
  private readonly negativeCacheMs: number
  private readonly positiveCacheMs: number
  private readonly maxConcurrency: number
  private activeFetches = 0
  private readonly fetchWaiters: Array<() => void> = []
  private apiFetchActive = false
  private apiAdmission: ApiAdmissionController
  private readonly cdnAdmissions = new Map<string, ApiAdmissionController>()
  private readonly cdnUsers = new Map<string, number>()
  private readonly apiFetchWaiters: Array<() => void> = []
  private vrcSessionProvider: (() => AvatarRequestLease | null) | null
  private diskStore: ImageDiskStore | null
  private makeAvatarRendition: AvatarRenditionMaker | null
  private makePictureRendition: AvatarRenditionMaker | null
  /** Full-picture URLs the server refused outright (too big, not an image, 4xx). */
  private readonly refusedPictures = new Map<string, number>()
  private refusedStreak = 0
  private fullPicturesPausedUntil = 0

  constructor(options: AvatarCacheOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? AVATAR_CACHE_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? AVATAR_CACHE_MAX_BYTES
    this.negativeCacheMs = options.negativeCacheMs ?? AVATAR_NEGATIVE_CACHE_MS
    this.positiveCacheMs = options.positiveCacheMs ?? AVATAR_POSITIVE_CACHE_MS
    this.maxConcurrency = options.maxConcurrency ?? AVATAR_FETCH_MAX_CONCURRENCY
    this.vrcSessionProvider = options.vrcSessionProvider ?? null
    this.diskStore = options.diskStore ?? null
    this.makeAvatarRendition = options.makeAvatarRendition ?? null
    this.makePictureRendition = options.makePictureRendition ?? null
    this.apiAdmission = options.apiAdmission ?? new ApiAdmissionController({ now: this.now })
  }

  /** Late wiring for the module singleton: index.ts registers the adapter's
   *  cookie accessor after the adapters are constructed (VRX-202). */
  setApiAdmission(admission: ApiAdmissionController): void {
    this.apiAdmission = admission
  }

  setVrcSessionProvider(provider: (() => AvatarRequestLease | null) | null): void {
    this.vrcSessionProvider = provider
  }

  setDiskStore(store: ImageDiskStore | null): void {
    this.diskStore = store
  }

  setAvatarRenditionMaker(maker: AvatarRenditionMaker | null): void {
    this.makeAvatarRendition = maker
  }

  setPictureRenditionMaker(maker: AvatarRenditionMaker | null): void {
    this.makePictureRendition = maker
  }

  /**
   * A world or avatar picture for a card, banner or tile, as sharp as the
   * platform offers. A VRChat sized thumbnail is swapped for its full picture
   * (`vrcFullPictureUrl`); one request either way. Only when VRChat refuses
   * the full picture outright (too big, not an image, a 4xx answer) is the
   * thumbnail requested instead, and that refusal is remembered for an hour so
   * it is not asked again. A transient failure (rate limit, network, no
   * session yet) requests nothing more and shows a thumbnail only if one is
   * already stored.
   */
  async getPicture(value: string): Promise<string | null> {
    const full = vrcFullPictureUrl(value)
    if (full === null || this.isRefused(full) || this.fullPicturesPausedUntil > this.now())
      return this.get(value, 'picture')
    const sharp = await this.get(full, 'picture')
    if (sharp !== null) {
      this.refusedStreak = 0
      return sharp
    }
    if (this.isRefused(full)) return this.get(value, 'picture')
    const parsed = parseAllowedAvatarUrl(value)
    return parsed === null ? null : this.readStored(parsed.href, 'picture')
  }

  private isRefused(url: string): boolean {
    const until = this.refusedPictures.get(url)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.refusedPictures.delete(url)
    return false
  }

  private markRefused(url: string): void {
    this.refusedStreak += 1
    if (this.refusedStreak >= PICTURE_REFUSED_STREAK_LIMIT) {
      this.refusedStreak = 0
      this.fullPicturesPausedUntil = this.now() + PICTURE_REFUSED_MS
    }
    this.refusedPictures.delete(url)
    this.refusedPictures.set(url, this.now() + PICTURE_REFUSED_MS)
    while (this.refusedPictures.size > PICTURE_REFUSED_MAX_ENTRIES) {
      const oldest = this.refusedPictures.keys().next().value
      if (oldest === undefined) break
      this.refusedPictures.delete(oldest)
    }
  }

  /** Explicit VRChat sign-out: forget every stored API image, on disk and in memory. */
  async clearStoredImages(): Promise<void> {
    for (const url of [...this.cache.keys()]) {
      if (new URL(url).hostname === AVATAR_COOKIE_HOST) this.deleteEntry(url)
    }
    await this.diskStore?.clear()
  }

  /**
   * Drop cached FAILURES (auth-boundary hook, VRX-202/Codex): a fetch that
   * 401'd around a login/logout/rotation would otherwise pin the placeholder
   * for the negative TTL. Positive entries stay — images are auth-invariant.
   * In-flight API images retain their lease and cannot repopulate stale entries.
   */
  clearNegativeEntries(): void {
    for (const [url, entry] of this.cache) {
      if (entry.dataUrl === null) this.deleteEntry(url)
    }
    this.refusedPictures.clear()
    this.refusedStreak = 0
    this.fullPicturesPausedUntil = 0
  }

  get(value: string, rendition: ImageRendition = 'original'): Promise<string | null> {
    const parsed = parseAllowedAvatarUrl(value)
    if (!parsed) return Promise.resolve(null)
    const url = parsed.href
    const key = renditionKey(url, rendition)

    const cached = this.cache.get(key)
    if (cached) {
      if (cached.expiresAt > this.now()) {
        // Re-insert to mark most recently used (Map keeps insertion order).
        this.cache.delete(key)
        this.cache.set(key, cached)
        return Promise.resolve(cached.dataUrl)
      }
      this.deleteEntry(key)
    }

    const lease = parsed.hostname === AVATAR_COOKIE_HOST ? this.vrcSessionProvider?.() : undefined
    // No durable session yet: no request, but an image already on disk can show.
    if (lease === null) return this.readStored(url, rendition)
    const pending = this.inFlight.get(key)
    const pendingLease = this.inFlightLeases.get(key)
    if (pending && (!pendingLease || (!pendingLease.signal.aborted && pendingLease.isCurrent())))
      return pending

    if (this.inFlight.size >= API_MAX_PENDING_ADMISSIONS) return Promise.resolve(null)
    const request = this.fetchAndCache(url, rendition, lease)
    this.inFlight.set(key, request)
    if (lease) this.inFlightLeases.set(key, lease)
    void request.finally(() => {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key)
        this.inFlightLeases.delete(key)
      }
    })
    return request
  }

  /**
   * Disk-tier lookup; a hit is also kept in memory. Never makes a request. An
   * `avatar` or `picture` miss can still be built from a stored original.
   */
  private async readStored(url: string, rendition: ImageRendition): Promise<string | null> {
    const store = this.storeFor(url)
    if (store === null) return null
    const key = renditionKey(url, rendition)
    let stored = await store.read(key).catch(() => null)
    if (stored === null && rendition !== 'original') {
      const original = await store.read(url).catch(() => null)
      if (original !== null) {
        stored = this.toRendition(original, rendition)
        if (stored !== original) void store.write(key, stored)
      }
    }
    if (stored === null) return null
    const dataUrl = toDataUrl(stored)
    this.setEntry(key, { dataUrl, expiresAt: this.now() + this.positiveCacheMs })
    return dataUrl
  }

  private storeFor(url: string): ImageDiskStore | null {
    return this.diskStore !== null && new URL(url).hostname === AVATAR_COOKIE_HOST
      ? this.diskStore
      : null
  }

  /** The image to keep for a rendition; the original when no smaller copy is made. */
  private toRendition(image: StoredImage, rendition: ImageRendition): StoredImage {
    const make =
      rendition === 'avatar'
        ? this.makeAvatarRendition
        : rendition === 'picture'
          ? this.makePictureRendition
          : null
    if (make === null) return image
    try {
      return make(image) ?? image
    } catch {
      return image
    }
  }

  private async fetchAndCache(
    url: string,
    rendition: ImageRendition,
    lease?: AvatarRequestLease
  ): Promise<string | null> {
    const stored = await this.readStored(url, rendition)
    if (stored !== null) return stored

    let image: StoredImage | null = null
    try {
      // Only full pictures are remembered as refused (see getPicture).
      const onRefused =
        rendition === 'picture' && VRC_FULL_PICTURE_RE.test(url)
          ? () => this.markRefused(url)
          : undefined
      image = await this.fetchAvatar(url, lease, onRefused)
    } catch {
      // Avatar failures are intentionally non-fatal; the renderer keeps the
      // initial-letter fallback and the short negative cache prevents hammering.
    }

    if (lease && (lease.signal.aborted || !lease.isCurrent())) return null
    const kept = image === null ? null : this.toRendition(image, rendition)
    const dataUrl = kept === null ? null : toDataUrl(kept)
    const key = renditionKey(url, rendition)
    if (kept !== null) void this.storeFor(url)?.write(key, kept)
    this.setEntry(key, {
      dataUrl,
      expiresAt: this.now() + (dataUrl === null ? this.negativeCacheMs : this.positiveCacheMs)
    })
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
  private async fetchAvatar(
    url: string,
    lease?: AvatarRequestLease,
    onRefused?: () => void
  ): Promise<StoredImage | null> {
    let target = new URL(url)
    for (let hop = 0; hop <= AVATAR_MAX_REDIRECTS; hop++) {
      assertRequestLease(lease)
      const usesApiLane = target.hostname === AVATAR_COOKIE_HOST
      const admission = usesApiLane ? this.apiAdmission : this.cdnAdmission(target.hostname)
      if (usesApiLane) {
        await this.acquireApiFetchSlot(lease?.signal)
        try {
          do {
            await admission.acquire({ priority: 'background', signal: lease?.signal })
          } while (admission.cooldownRemainingMs > 0)
        } catch (error) {
          this.releaseApiFetchSlot()
          throw error
        }
      } else {
        this.cdnUsers.set(target.hostname, (this.cdnUsers.get(target.hostname) ?? 0) + 1)
        try {
          // Do not occupy CDN body slots while one host is cooling down.
          for (;;) {
            await admission.acquire({ priority: 'background', signal: lease?.signal })
            await this.acquireFetchSlot(lease?.signal)
            if (admission.cooldownRemainingMs === 0) break
            this.releaseFetchSlot()
          }
        } catch (error) {
          this.releaseCdnUser(target.hostname)
          throw error
        }
      }
      const controller = new AbortController()
      try {
        assertRequestLease(lease)
        const headers: Record<string, string> = { 'User-Agent': VRC_USER_AGENT }
        if (usesApiLane) {
          const cookie = lease?.getCookie() ?? null
          if (cookie !== null) headers['Cookie'] = cookie
        }
        const response = await this.fetchFn(target.href, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(API_TIMEOUT_MS),
            ...(lease ? [lease.signal] : [])
          ])
        })

        if (response.status === 429) {
          admission.rateLimited(response.headers.get('Retry-After'))
          controller.abort()
          await response.body?.cancel()
          return null
        }
        if (response.ok) admission.succeeded()
        if (lease && (lease.signal.aborted || !lease.isCurrent())) {
          controller.abort()
          await response.body?.cancel().catch(() => {})
          return null
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          if (!usesApiLane) return null
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

        return await this.readImageBody(response, controller, onRefused)
      } finally {
        if (usesApiLane) {
          this.releaseApiFetchSlot()
        } else {
          this.releaseFetchSlot()
          this.releaseCdnUser(target.hostname)
        }
      }
    }
    return null
  }

  /**
   * `onRefused` hears a definite answer that this URL will not give a usable
   * image: a 4xx status (429 never gets here), a type that is not an allowed
   * image, or a body over the size limit. Network errors and 5xx do not count.
   */
  private async readImageBody(
    response: Response,
    controller: AbortController,
    onRefused?: () => void
  ): Promise<StoredImage | null> {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (!response.ok || !contentType || !AVATAR_ALLOWED_MIME_TYPES.has(contentType)) {
      // 401 is a session boundary, not a verdict on the picture.
      if (
        response.ok ||
        (response.status >= 400 && response.status < 500 && response.status !== 401)
      )
        onRefused?.()
      controller.abort()
      await response.body?.cancel()
      return null
    }

    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null) {
      const length = Number(declaredLength)
      if (!Number.isFinite(length) || length < 0 || length > AVATAR_MAX_BODY_BYTES) {
        onRefused?.()
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
        onRefused?.()
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
    return { contentType, bytes }
  }

  private acquireFetchSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new RequestCancelledError())
    if (this.activeFetches < this.maxConcurrency) {
      this.activeFetches += 1
      return Promise.resolve()
    }
    return this.waitForSlot(this.fetchWaiters, signal, () => {
      this.activeFetches += 1
    })
  }

  private releaseFetchSlot(): void {
    this.activeFetches -= 1
    this.fetchWaiters.shift()?.()
  }

  private cdnAdmission(host: string): ApiAdmissionController {
    let admission = this.cdnAdmissions.get(host)
    if (admission === undefined) {
      // Drop idle, expired host entries; active cooldowns must never be evicted.
      for (const [key, entry] of this.cdnAdmissions) {
        if (entry.cooldownRemainingMs === 0 && entry.pendingCount === 0 && !this.cdnUsers.has(key))
          this.cdnAdmissions.delete(key)
      }
      if (this.cdnAdmissions.size >= API_MAX_PENDING_ADMISSIONS) throw new RequestQueueFullError()
      admission = new ApiAdmissionController({ now: this.now, minimumIntervalMs: 0 })
      this.cdnAdmissions.set(host, admission)
    }
    return admission
  }

  private releaseCdnUser(host: string): void {
    const remaining = (this.cdnUsers.get(host) ?? 1) - 1
    if (remaining === 0) this.cdnUsers.delete(host)
    else this.cdnUsers.set(host, remaining)
  }

  private async acquireApiFetchSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new RequestCancelledError()
    if (this.apiFetchActive) {
      await this.waitForSlot(this.apiFetchWaiters, signal)
    } else {
      this.apiFetchActive = true
    }
  }

  private waitForSlot(
    waiters: Array<() => void>,
    signal?: AbortSignal,
    onAcquire?: () => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ready = (): void => {
        signal?.removeEventListener('abort', cancel)
        onAcquire?.()
        resolve()
      }
      const cancel = (): void => {
        const index = waiters.indexOf(ready)
        if (index !== -1) waiters.splice(index, 1)
        signal?.removeEventListener('abort', cancel)
        reject(new RequestCancelledError())
      }
      waiters.push(ready)
      signal?.addEventListener('abort', cancel, { once: true })
    })
  }

  private releaseApiFetchSlot(): void {
    const next = this.apiFetchWaiters.shift()
    if (next) {
      next()
    } else {
      this.apiFetchActive = false
    }
  }

  /** Retained size of one entry; negative entries cost nothing. */
  private static entryBytes(entry: CacheEntry): number {
    return entry.dataUrl?.length ?? 0
  }

  private deleteEntry(url: string): void {
    const entry = this.cache.get(url)
    if (!entry) return
    this.cachedBytes -= AvatarCache.entryBytes(entry)
    this.cache.delete(url)
  }

  private setEntry(url: string, entry: CacheEntry): void {
    this.deleteEntry(url)
    // An image larger than the whole budget is still returned to the caller,
    // just not retained (it would evict everything else and then itself).
    const bytes = AvatarCache.entryBytes(entry)
    if (bytes > this.maxBytes) return
    this.cache.set(url, entry)
    this.cachedBytes += bytes
    this.evictOldestEntries()
  }

  /** Evict least recently used entries until both the count and byte budgets hold. */
  private evictOldestEntries(): void {
    while (this.cache.size > this.maxEntries || this.cachedBytes > this.maxBytes) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.deleteEntry(oldest)
    }
  }

  /** Total retained data-URL size (test/diagnostic hook). */
  get retainedBytes(): number {
    return this.cachedBytes
  }
}

function toDataUrl(image: StoredImage): string {
  return `data:${image.contentType};base64,${image.bytes.toString('base64')}`
}

export const avatarCache = new AvatarCache()
