/**
 * useDragReorder — drag a row of a vertical list to a new place (quick
 * reorder; owner, 2026-11-15). Used by the sidebar pages and the Dashboard's
 * reorder list.
 *
 * A press that moves less than a few pixels stays a click, so a row that is
 * also a button still works. Past that, the row follows the pointer inside
 * the list and the rows it passes step aside; releasing reports the new order
 * once. Arrow Up and Arrow Down move the focused row one place, so the same
 * mode works from the keyboard, and focus stays on the moved row.
 *
 * The rows are measured once when the press starts. Nothing is written while
 * the pointer moves: `onReorder` runs only on release or an arrow key.
 *
 * Esc while a row is being dragged puts it back and keeps reorder mode on;
 * the key is taken, so the mode's own Esc waits for the next press. However
 * a drag ends without a drop (Esc, or the mode going off under it), the
 * release that follows is not a click: it must not open the row's page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampDrag, dropIndex, moveItem, rowShift, type RowBox } from '../utils/reorder'

/** Below this, a press on a row is a click, not a drag. */
const DRAG_SLOP_PX = 4

interface Press<T> {
  id: T
  pointerId: number
  startY: number
  from: number
  rows: RowBox[]
  active: boolean
}

interface Drag<T> {
  id: T
  from: number
  to: number
  dy: number
  rows: RowBox[]
}

export interface ReorderItemProps {
  ref: (element: HTMLElement | null) => void
  style: React.CSSProperties | undefined
  /** `true` on the dragged row, `false` on the others while a drag runs. */
  'data-dragging': 'true' | 'false' | undefined
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

export interface DragReorder<T> {
  /** The row being dragged, or null. */
  draggingId: T | null
  /** Spread onto each row. Returns nothing to spread while `enabled` is false. */
  itemProps: (id: T) => ReorderItemProps | undefined
}

export function useDragReorder<T extends string>({
  items,
  enabled,
  onReorder
}: {
  /** The rows on screen, in order. */
  items: readonly T[]
  enabled: boolean
  /** The new order, the row that moved and its new index. */
  onReorder: (next: T[], moved: T, index: number) => void
}): DragReorder<T> {
  const elements = useRef(new Map<T, HTMLElement>())
  const press = useRef<Press<T> | null>(null)
  const suppressClick = useRef(false)
  const focusAfterMove = useRef<T | null>(null)
  const [drag, setDrag] = useState<Drag<T> | null>(null)

  // A keyboard move reorders the DOM, which can drop focus from the moved
  // row; put it back once the new order has rendered.
  useLayoutEffect(() => {
    const id = focusAfterMove.current
    if (id === null) return
    focusAfterMove.current = null
    elements.current.get(id)?.focus()
  }, [items])

  const end = useCallback((): void => {
    press.current = null
    setDrag(null)
  }, [])

  // A drag that ends without a drop: forget the press, and swallow the click
  // its release would send. The listeners sit on the document because the
  // rows may have lost their handlers by then (the mode went off).
  const dropPress = useCallback((): void => {
    const wasDragging = press.current?.active === true
    press.current = null
    suppressClick.current = false
    if (wasDragging) swallowReleaseClick()
  }, [])

  // Leaving reorder mode in the middle of a drag drops the drag, and the press
  // behind it: the rows lose their handlers, so the release never arrives and
  // a kept press would refuse every drag the next time the mode starts.
  if (!enabled && drag !== null) setDrag(null)
  useEffect(() => {
    if (!enabled) dropPress()
  }, [enabled, dropPress])

  // Esc during a drag cancels the drag, not the mode. Capture phase, so this
  // runs before the mode's own Esc listener and marks the key as taken.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dropPress()
      setDrag(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dragging, dropPress])

  const itemProps = (id: T): ReorderItemProps | undefined => {
    if (!enabled) return undefined
    const index = items.indexOf(id)
    const style: React.CSSProperties | undefined =
      drag === null
        ? undefined
        : drag.id === id
          ? { transform: `translateY(${drag.dy}px)` }
          : { transform: `translateY(${rowShift(drag.rows, drag.from, drag.to, index)}px)` }

    return {
      ref: (element) => {
        if (element) elements.current.set(id, element)
        else elements.current.delete(id)
      },
      style,
      'data-dragging': drag === null ? undefined : drag.id === id ? 'true' : 'false',
      onPointerDown: (event) => {
        if (event.button !== 0 || press.current !== null) return
        const rows: RowBox[] = []
        for (const item of items) {
          const element = elements.current.get(item)
          if (!element) return
          const box = element.getBoundingClientRect()
          rows.push({ top: box.top, height: box.height })
        }
        press.current = {
          id,
          pointerId: event.pointerId,
          startY: event.clientY,
          from: index,
          rows,
          active: false
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      },
      onPointerMove: (event) => {
        const current = press.current
        if (current === null || current.id !== id || current.pointerId !== event.pointerId) return
        const raw = event.clientY - current.startY
        if (!current.active && Math.abs(raw) < DRAG_SLOP_PX) return
        current.active = true
        const dy = clampDrag(current.rows, current.from, raw)
        setDrag({
          id,
          from: current.from,
          to: dropIndex(current.rows, current.from, dy),
          dy,
          rows: current.rows
        })
      },
      onPointerUp: (event) => {
        const current = press.current
        if (current === null || current.id !== id || current.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        if (current.active) {
          // The click that follows a drag must not also press the row.
          suppressClick.current = true
          setTimeout(() => {
            suppressClick.current = false
          }, 0)
          const dy = clampDrag(current.rows, current.from, event.clientY - current.startY)
          const to = dropIndex(current.rows, current.from, dy)
          if (to !== current.from) onReorder(moveItem(items, current.from, to), id, to)
        }
        end()
      },
      onPointerCancel: (event) => {
        if (press.current?.pointerId === event.pointerId) end()
      },
      onClickCapture: (event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      },
      onKeyDown: (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        event.preventDefault()
        const to = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (index < 0 || to < 0 || to >= items.length) return
        focusAfterMove.current = id
        onReorder(moveItem(items, index, to), id, to)
      }
    }
  }

  return { draggingId: drag?.id ?? null, itemProps }
}

/**
 * Stops the click that the current press sends when it is released, then
 * steps aside. Used when a drag was abandoned: the pointer is still down, and
 * its release must not press whatever is under it.
 */
function swallowReleaseClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  const released = (): void => {
    document.removeEventListener('pointerup', released, true)
    document.removeEventListener('pointercancel', released, true)
    // The click follows the release in the same task; drop the guard after it.
    setTimeout(() => document.removeEventListener('click', swallow, true), 0)
  }
  document.addEventListener('click', swallow, true)
  document.addEventListener('pointerup', released, true)
  document.addEventListener('pointercancel', released, true)
}
