import { useEffect, useRef, useState } from 'react'
import type { Platform } from '@shared/types'
import { requestExploreImage, useExploreResetGeneration } from '../queries/explore'

/**
 * Resolves main-issued art only after its owning card becomes visible. The shared
 * image request cache lets a just-opened sheet reuse the card result, while a
 * session reset remounts the observer and clears every old-account image.
 */
export function useExploreImage(
  platform: Platform,
  worldRef: string,
  eager = false
): {
  ref: (element: HTMLElement | null) => void
  image: string | undefined
} {
  const resetGeneration = useExploreResetGeneration(platform)
  const elementRef = useRef<HTMLElement | null>(null)
  const key = `${resetGeneration}:${platform}:${worldRef}`
  const [visibleKey, setVisibleKey] = useState(eager ? key : null)
  const [resolved, setResolved] = useState<{ key: string; data: string } | null>(null)

  useEffect(() => {
    if (eager && visibleKey !== key) {
      queueMicrotask(() => setVisibleKey(key))
      return
    }
    if (visibleKey === key || typeof IntersectionObserver === 'undefined') return
    const element = elementRef.current
    if (element === null) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisibleKey(key)
        observer.disconnect()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [eager, key, visibleKey])

  useEffect(() => {
    if (visibleKey !== key) return
    let cancelled = false
    void requestExploreImage(platform, worldRef)
      .then((data) => {
        if (!cancelled && data !== undefined) setResolved({ key, data })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [key, platform, visibleKey, worldRef])

  return {
    ref: (element) => {
      elementRef.current = element
      if (element !== null && typeof IntersectionObserver === 'undefined') setVisibleKey(key)
    },
    image: resolved?.key === key ? resolved.data : undefined
  }
}
