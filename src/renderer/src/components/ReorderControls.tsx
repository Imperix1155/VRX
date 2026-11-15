/**
 * Quick reorder controls (owner, 2026-11-15): the grip glyph on a movable
 * row, the small right-click menu that starts or ends reorder mode, and the
 * "Reset order" and "Done" buttons shown while it is on.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReorderMode, type MenuPoint } from '../hooks/useReorderMode'

/** Six dots: the "you can drag this" mark. Decorative; the hint says it in words. */
export function GripIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 10 16"
      width="10"
      height="16"
      aria-hidden="true"
      data-reorder-grip=""
      className={`shrink-0 fill-current ${className}`}
    >
      <circle cx="2.5" cy="3" r="1.3" />
      <circle cx="7.5" cy="3" r="1.3" />
      <circle cx="2.5" cy="8" r="1.3" />
      <circle cx="7.5" cy="8" r="1.3" />
      <circle cx="2.5" cy="13" r="1.3" />
      <circle cx="7.5" cy="13" r="1.3" />
    </svg>
  )
}

const MENU_EDGE_PX = 6

/**
 * The right-click menu: one item, "Reorder", or "Done" while reorder mode is
 * on. Opaque like every menu. Esc, a press outside or focus leaving folds it.
 * Render it as a direct child of the positioned container `useReorderMenu`
 * measures.
 */
export function ReorderMenu({
  point,
  onClose
}: {
  point: MenuPoint | null
  onClose: (restoreFocus?: boolean) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { on, start, stop } = useReorderMode()
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  const [nudge, setNudge] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Keep the whole menu inside its container (its parent), then put focus on
  // its item.
  useLayoutEffect(() => {
    const menu = menuRef.current
    const container = menu?.parentElement
    if (point === null || !menu || !container) return
    const overX = point.x + menu.offsetWidth + MENU_EDGE_PX - container.clientWidth
    const overY = point.y + menu.offsetHeight + MENU_EDGE_PX - container.clientHeight
    setNudge({
      x: Math.min(0, Math.max(-overX, MENU_EDGE_PX - point.x)),
      y: Math.min(0, Math.max(-overY, MENU_EDGE_PX - point.y))
    })
    itemRef.current?.focus()
  }, [point])

  useEffect(() => {
    if (point === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onClose()
    }
    const onBlur = (): void => onClose()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [point, onClose])

  if (point === null) return null
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('reorder.menuAria')}
      data-reorder-menu=""
      className="glass glass-information absolute z-30 min-w-[150px] rounded-control p-[4px]"
      style={{ left: point.x + nudge.x, top: point.y + nudge.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // The menu folds first; reorder mode's own Esc waits for the next press.
          event.preventDefault()
          event.stopPropagation()
          onClose(true)
        } else if (event.key === 'Tab') {
          onClose(true)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        className="flex w-full cursor-pointer items-center gap-[var(--space-2)] rounded-[8px] px-[10px] py-[7px] text-left text-[13px] font-medium whitespace-nowrap text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
        onClick={() => {
          if (on) stop()
          else start()
          onClose(true)
        }}
      >
        <GripIcon className="text-[var(--text-dim)]" />
        {t(on ? 'reorder.done' : 'reorder.start')}
      </button>
    </div>
  )
}

const ACTION_CLASS =
  'rounded-control bg-[var(--control-fill)] px-[var(--space-2)] py-[var(--space-2)] text-xs whitespace-nowrap ' +
  'hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] ' +
  'motion-safe:transition-colors'

/**
 * "Reset order" and "Done", shown wherever reorder mode is on. Reset stays
 * focusable when there is nothing to reset (`aria-disabled`), so a press never
 * drops keyboard focus. `fill` makes the two share the whole row.
 */
export function ReorderActions({ fill = false }: { fill?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { stop, reset, isDefault } = useReorderMode()
  const [announcement, setAnnouncement] = useState('')
  const grow = fill ? 'flex-auto' : 'px-[var(--space-3)]'
  return (
    <div className="flex shrink-0 items-center gap-[var(--space-2)]" data-reorder-actions="">
      <button
        type="button"
        title={t('reorder.resetNote')}
        aria-disabled={isDefault || undefined}
        className={`${ACTION_CLASS} ${grow} ${isDefault ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'}`}
        onClick={() => {
          if (isDefault) return
          reset()
          setAnnouncement(t('reorder.resetDone'))
        }}
      >
        {t('reorder.reset')}
      </button>
      <button
        type="button"
        className={`${ACTION_CLASS} ${grow} font-semibold text-[var(--text)]`}
        onClick={stop}
      >
        {t('reorder.done')}
      </button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
