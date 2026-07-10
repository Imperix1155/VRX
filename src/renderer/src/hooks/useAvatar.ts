import { useEffect, useState, type RefObject } from 'react'

const avatarRequests = new Map<string, Promise<string | null>>()

function requestAvatar(url: string): Promise<string | null> {
  const cached = avatarRequests.get(url)
  if (cached) return cached

  const request =
    typeof window === 'undefined' || typeof window.vrx === 'undefined'
      ? Promise.resolve(null)
      : window.vrx
          .getAvatar(url)
          .then((result) => result?.dataUrl ?? null)
          .catch(() => null)
  avatarRequests.set(url, request)
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
