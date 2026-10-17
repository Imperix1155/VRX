import { useEffect, useState, type RefObject } from 'react'

const AVATAR_RENDERER_CACHE_MAX_ENTRIES = 200
/** Just past main's 30 s negative cache, so a retry can reach the network again. */
export const AVATAR_RETRY_DELAY_MS = 31_000
/** Bounded: a permanently missing image stops after this many re-attempts. */
export const AVATAR_MAX_RETRIES = 3

const avatarData = new Map<string, string>()
const avatarRequests = new Map<string, Promise<string | null>>()

function cacheSuccessfulAvatar(url: string, dataUrl: string): void {
  avatarData.delete(url)
  avatarData.set(url, dataUrl)
  while (avatarData.size > AVATAR_RENDERER_CACHE_MAX_ENTRIES) {
    const oldest = avatarData.keys().next().value
    if (oldest === undefined) return
    avatarData.delete(oldest)
  }
}

function requestAvatar(url: string): Promise<string | null> {
  const cached = avatarData.get(url)
  if (cached) {
    avatarData.delete(url)
    avatarData.set(url, cached)
    return Promise.resolve(cached)
  }

  const pending = avatarRequests.get(url)
  if (pending) return pending

  const request =
    typeof window === 'undefined' || typeof window.vrx === 'undefined'
      ? Promise.resolve(null)
      : window.vrx
          .getAvatar(url)
          .then((result) => {
            const dataUrl = result?.dataUrl ?? null
            if (dataUrl !== null) cacheSuccessfulAvatar(url, dataUrl)
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
