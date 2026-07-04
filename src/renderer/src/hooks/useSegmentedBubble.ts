import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Sliding-bubble geometry for a segmented control (§9 pattern): measures the
 * ACTIVE button's real left/width inside the track. Labels are unequal widths
 * ("All" vs "ChilloutVR", "VRChat" vs "Per platform"), so a fixed 1/N-width
 * bubble cannot line up — it has to track the actual button box.
 *
 * useLayoutEffect places it before paint; re-measures once layout settles
 * (next frame) and after web fonts load — the first paint can measure stale
 * (too-narrow) label widths otherwise; the ResizeObserver keeps it aligned on
 * window resizes; i18n.language re-measures when labels re-render with
 * differently-sized text (audit W5 — the ResizeObserver watches the TRACK,
 * which may not resize).
 *
 * Shared by TopBar's platform filter and SettingsView's rows (VRX-183).
 */
export function useSegmentedBubble(activeIndex: number): {
  trackRef: RefObject<HTMLDivElement | null>
  bubble: { left: number; width: number }
} {
  const { i18n } = useTranslation()
  const trackRef = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<{ left: number; width: number }>({ left: 4, width: 0 })

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    let cancelled = false
    const place = (): void => {
      if (cancelled) return
      const btn = track.querySelectorAll('button')[activeIndex] as HTMLElement | undefined
      if (btn) setBubble({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    place()
    const raf = requestAnimationFrame(place)
    document.fonts?.ready.then(place).catch(() => {})
    const ro = new ResizeObserver(place)
    ro.observe(track)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [activeIndex, i18n.language])

  return { trackRef, bubble }
}
