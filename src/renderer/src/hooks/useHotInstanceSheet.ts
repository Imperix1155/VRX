import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotInstance } from '../utils/dashboardAggregations'

/**
 * Hot-instance sheet selection (VRX-250), shared by the Dashboard and the Hot
 * Instances page. Stores the composite key and derives the live instance from
 * the current hot list every render, so the sheet stays truthful as friends or
 * rosters change, and self-closes when the selected instance stops being hot
 * (friends left, account switched, threshold/filter changed).
 *
 * `onBeforeOpen` lets the Dashboard dismiss its other (Explore) sheet first, so
 * keyboard activation can never stack panels. Closing restores focus to the
 * opener when it is still connected, else to `fallbackFocusRef`.
 */
export function useHotInstanceSheet(
  hotInstances: readonly HotInstance[],
  onBeforeOpen?: () => void
): {
  selectedInstance: HotInstance | null
  openSheet: (instance: HotInstance, opener: HTMLElement) => void
  closeSheet: () => void
  clearSelection: () => void
  fallbackFocusRef: React.RefObject<HTMLElement | null>
} {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const fallbackFocusRef = useRef<HTMLElement | null>(null)
  const beforeOpenRef = useRef(onBeforeOpen)
  useEffect(() => {
    beforeOpenRef.current = onBeforeOpen
  })

  const openSheet = useCallback((instance: HotInstance, opener: HTMLElement) => {
    beforeOpenRef.current?.()
    openerRef.current = opener
    setSelectedGroupKey(instance.groupKey)
  }, [])
  const closeSheet = useCallback(() => {
    setSelectedGroupKey(null)
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    else fallbackFocusRef.current?.focus({ preventScroll: true })
  }, [])
  /** Drop the selection without moving focus (another sheet took over). */
  const clearSelection = useCallback(() => setSelectedGroupKey(null), [])

  const selectedInstance = hotInstances.find((h) => h.groupKey === selectedGroupKey) ?? null

  // Mirrors FriendsList's stale-selection cleanup (VRX-250 review); the
  // setState-in-effect is intentional and bounded.
  useEffect(() => {
    if (selectedGroupKey !== null && selectedInstance === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      closeSheet()
    }
  }, [selectedGroupKey, selectedInstance, closeSheet])

  return { selectedInstance, openSheet, closeSheet, clearSelection, fallbackFocusRef }
}
