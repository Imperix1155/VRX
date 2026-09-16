import { useCallback, useEffect, useRef, useState } from 'react'
import type { Platform } from '@shared/types'
import { observeExploreImage, useExploreResetGeneration } from '../queries/explore'

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
  const [visibleKey, setVisibleKey] = useState<string | null>(eager ? key : null)
  const [resolved, setResolved] = useState<{ key: string; data: string } | null>(null)

  useEffect(() => {
    if (eager || typeof IntersectionObserver === 'undefined') return
    const element = elementRef.current
    if (element === null) return
    const observer = new IntersectionObserver(([entry]) => {
      setVisibleKey(entry?.isIntersecting === true ? key : null)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [eager, key])

  useEffect(() => {
    if (!eager && visibleKey !== key) return
    return observeExploreImage(platform, worldRef, (data) => {
      if (data !== undefined) setResolved({ key, data })
    })
  }, [eager, key, platform, visibleKey, worldRef])

  const ref = useCallback(
    (element: HTMLElement | null) => {
      elementRef.current = element
      if (element === null) setVisibleKey(null)
      else if (typeof IntersectionObserver === 'undefined') setVisibleKey(key)
    },
    [key]
  )

  return {
    ref,
    image: resolved?.key === key ? resolved.data : undefined
  }
}
