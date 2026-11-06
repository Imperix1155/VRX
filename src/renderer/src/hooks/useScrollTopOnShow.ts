import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * A sheet's scroll area that starts at the top whenever the sheet opens or
 * shows another item (`itemKey`). Sheets stay mounted between items, so the
 * scroll position would otherwise carry over. Put the ref on the element that
 * scrolls.
 */
export function useScrollTopOnShow(
  open: boolean,
  itemKey: string | null = null
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (open && ref.current) ref.current.scrollTop = 0
  }, [open, itemKey])
  return ref
}
