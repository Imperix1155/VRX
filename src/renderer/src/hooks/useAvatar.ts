import { useEffect, useState, type RefObject } from 'react'

const AVATAR_RENDERER_CACHE_MAX_ENTRIES = 200

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
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void requestAvatar(url).then((result) => {
          if (active) setLoaded({ url, dataUrl: result })
        })
      },
      { rootMargin: '200px' }
    )
    observer.observe(target)

    return () => {
      active = false
      observer.disconnect()
    }
  }, [targetRef, url])

  return loaded?.url === url ? loaded.dataUrl : null
}
