import { useEffect, useState, type RefObject } from 'react'
import { apiImageQueue, DROPPED, isApiImageUrl, type QueuedResult } from './apiImageQueue'

export const AVATAR_RENDERER_CACHE_MAX_ENTRIES = 200
/** Aggregate data-URL budget for the renderer copy (#370); mirrors main's. */
export const AVATAR_RENDERER_CACHE_MAX_BYTES = 48 * 1024 * 1024
/** Just past main's 30 s negative cache, so a retry can reach the network again. */
export const AVATAR_RETRY_DELAY_MS = 31_000
/** Bounded: a permanently missing image stops after this many re-attempts. */
export const AVATAR_MAX_RETRIES = 3

/**
 * LRU of successful avatar data URLs, bounded by entry count AND total size
 * (data-URL characters ≈ bytes, base64 is ASCII). An entry larger than the
 * whole budget is not retained.
 */
export class AvatarDataCache {
  private readonly entries = new Map<string, string>()
  private bytes = 0

  constructor(
    private readonly maxEntries = AVATAR_RENDERER_CACHE_MAX_ENTRIES,
    private readonly maxBytes = AVATAR_RENDERER_CACHE_MAX_BYTES
  ) {}

  get size(): number {
    return this.entries.size
  }

  get retainedBytes(): number {
    return this.bytes
  }

  /** Read and mark most recently used. */
  get(url: string): string | undefined {
    const value = this.entries.get(url)
    if (value === undefined) return undefined
    this.entries.delete(url)
    this.entries.set(url, value)
    return value
  }

  /** Read without changing the eviction order (safe during render). */
  peek(url: string): string | undefined {
    return this.entries.get(url)
  }

  set(url: string, dataUrl: string): void {
    this.delete(url)
    if (dataUrl.length > this.maxBytes) return
    this.entries.set(url, dataUrl)
    this.bytes += dataUrl.length
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) return
      this.delete(oldest)
    }
  }

  private delete(url: string): void {
    const value = this.entries.get(url)
    if (value === undefined) return
    this.bytes -= value.length
    this.entries.delete(url)
  }
}

const avatarData = new AvatarDataCache()
const avatarRequests = new Map<string, Promise<QueuedResult>>()
let nextWatcher = 0

/**
 * `avatar` is the small copy for round friend pictures. `picture` is the sharp,
 * card-sized copy for world and avatar pictures on cards, tiles and banners.
 * Everything else keeps the original.
 */
export type AvatarRendition = 'original' | 'avatar' | 'picture'

function cacheKey(url: string, rendition: AvatarRendition): string {
  return rendition === 'original' ? url : `${rendition}\u0000${url}`
}

type Bridge = NonNullable<Window['vrx']>

function askMain(vrx: Bridge, url: string, rendition: AvatarRendition): Promise<string | null> {
  return (rendition === 'original' ? vrx.getAvatar(url) : vrx.getAvatar(url, rendition))
    .then((result) => result?.dataUrl ?? null)
    .catch(() => null)
}

/** A copy main already keeps (memory or disk); never a download. */
function askMainKept(vrx: Bridge, url: string, rendition: AvatarRendition): Promise<string | null> {
  if (typeof vrx.getKeptAvatar !== 'function') return Promise.resolve(null)
  return (rendition === 'original' ? vrx.getKeptAvatar(url) : vrx.getKeptAvatar(url, rendition))
    .then((result) => result?.dataUrl ?? null)
    .catch(() => null)
}

/**
 * One shared request per picture. A VRChat API-host picture is first looked up
 * among the copies main keeps; only a real download waits in `apiImageQueue`,
 * which may drop it (`DROPPED`) once no tile wants it.
 */
function requestAvatar(url: string, rendition: AvatarRendition): Promise<QueuedResult> {
  const key = cacheKey(url, rendition)
  const cached = avatarData.get(key)
  if (cached) return Promise.resolve(cached)

  const pending = avatarRequests.get(key)
  if (pending) return pending

  const vrx = typeof window === 'undefined' ? undefined : window.vrx
  if (vrx === undefined) return Promise.resolve(null)
  const request: Promise<QueuedResult> = (
    isApiImageUrl(url)
      ? askMainKept(vrx, url, rendition).then(
          (kept): Promise<QueuedResult> | QueuedResult =>
            kept ?? apiImageQueue.enqueue(key, () => askMain(vrx, url, rendition))
        )
      : askMain(vrx, url, rendition)
  )
    .then((result) => {
      if (typeof result === 'string') avatarData.set(key, result)
      return result
    })
    .catch(() => null)
  avatarRequests.set(key, request)
  void request.finally(() => {
    if (avatarRequests.get(key) === request) avatarRequests.delete(key)
  })
  return request
}

export interface AvatarImage {
  /** The picture as a data URL, or null while it loads or when there is none. */
  dataUrl: string | null
  /** True until the first answer for this picture: show a loading look, not "no picture". */
  pending: boolean
  /** True when the picture was already in memory at first render: show it without a fade. */
  instant: boolean
}

/**
 * Load a picture only when its observed element nears the viewport. A picture
 * already loaded this session shows on the first render. VRChat API-host
 * pictures wait in `apiImageQueue`, which serves on-screen tiles first.
 */
export function useAvatarImage(
  url: string | null,
  targetRef: RefObject<Element | null>,
  rendition: AvatarRendition = 'original'
): AvatarImage {
  const key = url ? cacheKey(url, rendition) : null
  const [loaded, setLoaded] = useState<{ key: string; dataUrl: string | null } | null>(null)
  const kept = key === null ? undefined : avatarData.peek(key)
  // Remember what this element first showed from memory, so a picture evicted
  // from the shared memory copy while it is still on screen does not blink
  // out, and one shown on the first render is marked instant (no fade).
  const [shown, setShown] = useState<{ key: string; dataUrl: string; instant: boolean } | null>(
    null
  )
  const keptShown =
    key === null
      ? null
      : shown?.key === key
        ? shown
        : kept === undefined
          ? null
          : { key, dataUrl: kept, instant: loaded?.key !== key }
  if (keptShown !== null && keptShown !== shown) setShown(keptShown)
  const answered = key !== null && loaded?.key === key

  useEffect(() => {
    const target = targetRef.current
    if (!url || !target || typeof IntersectionObserver === 'undefined') return
    const key = cacheKey(url, rendition)
    if (avatarData.peek(key) !== undefined) return

    const queued = isApiImageUrl(url)
    const watcher = ++nextWatcher
    let active = true
    let requested = false
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const run = (): void => {
      requested = true
      void requestAvatar(url, rendition).then((result) => {
        if (!active) return
        // Another tile's wait for this picture was dropped as it left; ask again.
        if (result === DROPPED) {
          run()
          return
        }
        observer.disconnect()
        if (queued) apiImageQueue.release(key, watcher)
        setLoaded({ key, dataUrl: result })
        // A transient failure (network, rate limit, negative cache) resolves to
        // null. Re-arm visibility after the negative-cache window so an avatar
        // that is still on screen gets another chance; off-screen rows wait
        // until they intersect again.
        if (result === null && retries < AVATAR_MAX_RETRIES) {
          retries += 1
          retryTimer = setTimeout(() => {
            if (!active) return
            requested = false
            observer.observe(target)
          }, AVATAR_RETRY_DELAY_MS)
        }
      })
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting)
        // Queued pictures follow their tile: on screen first, scrolled away wait.
        if (queued) apiImageQueue.watch(key, watcher, visible)
        if (visible && !requested) run()
      },
      { rootMargin: '200px' }
    )
    observer.observe(target)

    return () => {
      active = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      observer.disconnect()
      if (queued) apiImageQueue.release(key, watcher)
    }
  }, [rendition, targetRef, url])

  if (key === null) return { dataUrl: null, pending: false, instant: false }
  const dataUrl = kept ?? (answered ? loaded.dataUrl : null) ?? keptShown?.dataUrl ?? null
  return {
    dataUrl,
    pending: dataUrl === null && !answered,
    instant: dataUrl !== null && keptShown?.instant === true
  }
}

/** Load an avatar only when its observed element enters the near viewport. */
export function useAvatar(
  url: string | null,
  targetRef: RefObject<Element | null>,
  rendition: AvatarRendition = 'original'
): string | null {
  return useAvatarImage(url, targetRef, rendition).dataUrl
}
