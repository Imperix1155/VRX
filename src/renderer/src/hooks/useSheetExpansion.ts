/**
 * useSheetExpansion — the grab bar on every bottom sheet (Hot Instance,
 * Explore world, Avatar, person and group sheets).
 *
 * A sheet opens collapsed. Dragging the bar up expands it to nearly the full
 * window height, dragging down collapses it, and dragging a collapsed sheet
 * down closes it. A click, Enter or Space toggles; Arrow Up expands and Arrow
 * Down collapses. Every reopen starts collapsed (simple by default).
 *
 * The sheet animates between two explicit min/max heights, so CSS can tween
 * the change without measuring content. While a finger or mouse drags, the
 * height (or, below the collapsed height, the slide-down offset) follows the
 * pointer with transitions off; on release the inline values drop away and
 * the panel's own transition carries it to the chosen state.
 */
import { useCallback, useRef, useState } from 'react'

/** The expanded sheet leaves this much of the page visible above it. */
export const SHEET_EXPANDED_GAP_PX = 64
export const SHEET_EXPANDED_HEIGHT = `calc(100vh - ${SHEET_EXPANDED_GAP_PX}px)`

/** Below this, a press on the bar is a click, not a drag. */
const DRAG_SLOP_PX = 4
/** A drag this far (or a quick flick) changes state; less snaps back. */
const CHANGE_DISTANCE_PX = 56
const CLOSE_DISTANCE_PX = 72
const FLICK_PX_PER_MS = 0.5
/** A release this long after the last movement was a hold, not a flick. */
const FLICK_WINDOW_MS = 100

export interface SheetHeights {
  /** CSS lengths only (never `auto`), so the change can animate. */
  minHeight: string
  maxHeight: string
}

interface DragState {
  /** The panel height under the pointer, in px. */
  height: number
  /** How far the collapsed panel has slid down, in px. */
  offset: number
}

export interface SheetExpansion {
  expanded: boolean
  dragging: boolean
  /** Inline style for the panel: its heights, plus the drag override. */
  panelStyle: React.CSSProperties
  /** Spread onto the grab-bar button. */
  handleProps: {
    'aria-expanded': boolean
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void
    onClick: (event: React.MouseEvent<HTMLElement>) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  }
}

interface Gesture {
  pointerId: number
  startY: number
  startHeight: number
  startExpanded: boolean
  collapsedHeight: number
  moved: boolean
  /** The two latest pointer samples, for the release speed. */
  prevY: number
  prevTime: number
  lastY: number
  lastTime: number
}

export function useSheetExpansion({
  open,
  onClose,
  panelRef,
  collapsed
}: {
  open: boolean
  onClose: () => void
  panelRef: React.RefObject<HTMLElement | null>
  collapsed: SheetHeights
}): SheetExpansion {
  const [expanded, setExpanded] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Each reopen starts collapsed. Reset on the opening edge, not on close,
  // so a closing sheet slides away at the size it had.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setExpanded(false)
      setDrag(null)
    }
  }

  const gestureRef = useRef<Gesture | null>(null)
  // The collapsed height, measured the last time the panel sat collapsed.
  const collapsedHeightRef = useRef<number | null>(null)
  // A pointer press already toggled; swallow the click event that follows it.
  const suppressClickRef = useRef(false)

  const measure = useCallback((): number => {
    return panelRef.current?.getBoundingClientRect().height ?? 0
  }, [panelRef])

  const expand = useCallback((): void => {
    if (!expanded) collapsedHeightRef.current = measure()
    setExpanded(true)
  }, [expanded, measure])

  const collapse = useCallback((): void => {
    setExpanded(false)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (event.button !== 0 || gestureRef.current !== null) return
      const startHeight = measure()
      if (!expanded) collapsedHeightRef.current = startHeight
      const now = performance.now()
      gestureRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight,
        startExpanded: expanded,
        collapsedHeight: collapsedHeightRef.current ?? startHeight,
        moved: false,
        prevY: event.clientY,
        prevTime: now,
        lastY: event.clientY,
        lastTime: now
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [expanded, measure]
  )

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    const dy = event.clientY - gesture.startY
    if (!gesture.moved && Math.abs(dy) < DRAG_SLOP_PX) return
    gesture.moved = true
    gesture.prevY = gesture.lastY
    gesture.prevTime = gesture.lastTime
    gesture.lastY = event.clientY
    gesture.lastTime = performance.now()
    const maxHeight = Math.max(gesture.collapsedHeight, window.innerHeight - SHEET_EXPANDED_GAP_PX)
    const wanted = gesture.startHeight - dy
    if (wanted >= gesture.collapsedHeight) {
      setDrag({ height: Math.min(wanted, maxHeight), offset: 0 })
    } else {
      setDrag({ height: gesture.collapsedHeight, offset: gesture.collapsedHeight - wanted })
    }
  }, [])

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>, cancelled: boolean): void => {
      const gesture = gestureRef.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      gestureRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setDrag(null)
      if (cancelled) return
      suppressClickRef.current = true
      if (!gesture.moved) {
        // A plain press on the bar toggles, like a click.
        if (gesture.startExpanded) collapse()
        else expand()
        return
      }
      const dy = event.clientY - gesture.startY
      const now = performance.now()
      const velocity =
        now - gesture.lastTime > FLICK_WINDOW_MS
          ? 0
          : (event.clientY - gesture.prevY) / Math.max(1, now - gesture.prevTime)
      const wanted = gesture.startHeight - dy
      const below = gesture.collapsedHeight - wanted
      if (below > 0 && (below >= CLOSE_DISTANCE_PX || velocity >= FLICK_PX_PER_MS * 2)) {
        // Pulled down past the collapsed size: close.
        onClose()
        return
      }
      if (gesture.startExpanded) {
        if (dy >= CHANGE_DISTANCE_PX || velocity >= FLICK_PX_PER_MS) collapse()
        else setExpanded(true)
      } else if (-dy >= CHANGE_DISTANCE_PX || velocity <= -FLICK_PX_PER_MS) {
        setExpanded(true)
      } else {
        setExpanded(false)
      }
    },
    [collapse, expand, onClose]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => finish(event, false),
    [finish]
  )
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => finish(event, true),
    [finish]
  )

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      event.stopPropagation()
      // A pointer press handled it already; keyboard and assistive-tech
      // clicks arrive without one.
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      if (expanded) collapse()
      else expand()
    },
    [collapse, expand, expanded]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      suppressClickRef.current = false
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        expand()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        collapse()
      }
    },
    [collapse, expand]
  )

  const target = expanded ? SHEET_EXPANDED_HEIGHT : null
  const panelStyle: React.CSSProperties =
    drag === null
      ? {
          minHeight: target ?? collapsed.minHeight,
          maxHeight: target ?? collapsed.maxHeight
        }
      : {
          minHeight: `${drag.height}px`,
          maxHeight: `${drag.height}px`,
          translate: drag.offset > 0 ? `0 ${drag.offset}px` : undefined,
          transition: 'none'
        }

  return {
    expanded,
    dragging: drag !== null,
    panelStyle,
    handleProps: {
      'aria-expanded': expanded,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
      onKeyDown
    }
  }
}
