import { useEffect, useState, type RefObject } from 'react'

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
const avatarRequests = new Map<string, Promise<string | null>>()

function requestAvatar(url: string): Promise<string | null> {
  const cached = avatarData.get(url)
  if (cached) return Promise.resolve(cached)

  const pending = avatarRequests.get(url)
  if (pending) return pending

  const request =
    typeof window === 'undefined' || typeof window.vrx === 'undefined'
      ? Promise.resolve(null)
      : window.vrx
          .getAvatar(url)
          .then((result) => {
            const dataUrl = result?.dataUrl ?? null
            if (dataUrl !== null) avatarData.set(url, dataUrl)
            return dataUrl
          })
          .catch(() => null)
  avatarRequests.set(url, request)
  void request.finally(() => avatarRequests.delete(url))
  return request
}

/** Load an avatar only when its observed element enters the near viewport. */
export function useAvatar(url: string | null, targetRef: RefObject<Element | null>): string | null {
  const [loaded, setLoaded] = useState<{ url: string; dataUrl: string | null } | null>(null)

  useEffect(() => {
    const target = targetRef.current
    if (!url || !target || typeof IntersectionObserver === 'undefined') return

    let active = true
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void requestAvatar(url).then((result) => {
          if (!active) return
          setLoaded({ url, dataUrl: result })
          // A transient failure (network, rate limit, negative cache) resolves to
          // null. Re-arm visibility after the negative-cache window so an avatar
          // that is still on screen gets another chance; off-screen rows wait
          // until they intersect again.
          if (result === null && retries < AVATAR_MAX_RETRIES) {
            retries += 1
            retryTimer = setTimeout(() => {
              if (active) observer.observe(target)
            }, AVATAR_RETRY_DELAY_MS)
          }
        })
      },
      { rootMargin: '200px' }
    )
    observer.observe(target)

    return () => {
      active = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      observer.disconnect()
    }
  }, [targetRef, url])

  return loaded?.url === url ? loaded.dataUrl : null
}
