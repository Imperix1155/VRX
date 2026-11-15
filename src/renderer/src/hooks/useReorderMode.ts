/**
 * Quick reorder (owner, 2026-11-15): the session-only mode in which the
 * sidebar pages and the Dashboard sections can be dragged into a new order,
 * the small right-click menu that starts it, and "Reset order".
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/settings'
import { DASHBOARD_SECTIONS, SIDEBAR_PAGES, dashboardSectionOrderOf } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

/** The settings that put the sidebar and the Dashboard back in their original order. */
export function defaultOrderSettings(): Pick<
  Settings,
  'sidebarOrder' | 'dashboardSections' | 'dashboardSectionOrder'
> {
  return {
    sidebarOrder: [...SIDEBAR_PAGES],
    dashboardSections: [...DASHBOARD_SECTIONS],
    dashboardSectionOrder: dashboardSectionOrderOf(DASHBOARD_SECTIONS)
  }
}

/** Whether the sidebar and the Dashboard are both in their original order. */
export function isDefaultOrder(
  settings: Pick<Settings, 'sidebarOrder' | 'dashboardSections'>
): boolean {
  return (
    settings.sidebarOrder.every((page, index) => page === SIDEBAR_PAGES[index]) &&
    settings.dashboardSections.every((section, index) => section === DASHBOARD_SECTIONS[index])
  )
}

export interface ReorderMode {
  on: boolean
  start: () => void
  stop: () => void
  /** Sidebar and Dashboard back to their original order. */
  reset: () => void
  /** Nothing has been moved, so there is nothing to reset. */
  isDefault: boolean
}

export function useReorderMode(): ReorderMode {
  const on = useUiStore((s) => s.reorderMode)
  const setReorderMode = useUiStore((s) => s.setReorderMode)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const isDefault = useSettingsStore((s) => isDefaultOrder(s.settings))
  const start = useCallback(() => setReorderMode(true), [setReorderMode])
  const stop = useCallback(() => setReorderMode(false), [setReorderMode])
  const reset = useCallback(() => updateSettings(defaultOrderSettings()), [updateSettings])
  return { on, start, stop, reset, isDefault }
}

/** Esc ends reorder mode, unless something else (a menu, a sheet) took the key. */
export function useReorderEscape(): void {
  const on = useUiStore((s) => s.reorderMode)
  useEffect(() => {
    if (!on) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      useUiStore.getState().setReorderMode(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [on])
}

/** Where the right-click menu opens, measured from its container's corner. */
export interface MenuPoint {
  x: number
  y: number
}

export interface ReorderMenuState {
  point: MenuPoint | null
  /** Undefined while "Quick reorder" is off, so a right-click does nothing. */
  onContextMenu: ((event: React.MouseEvent<HTMLElement>) => void) | undefined
  /** Folds the menu; `restoreFocus` hands focus back to where it was. */
  close: (restoreFocus?: boolean) => void
}

/**
 * The right-click menu's state for one container. The container must be
 * positioned (`relative`): the menu is absolute inside it, never fixed, so a
 * glass parent's blur cannot pin it somewhere else.
 */
export function useReorderMenu(
  containerRef: React.RefObject<HTMLElement | null>
): ReorderMenuState {
  const quickReorder = useSettingsStore((s) => s.settings.quickReorder)
  const [point, setPoint] = useState<MenuPoint | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  const close = useCallback((restoreFocus = false): void => {
    setPoint(null)
    if (restoreFocus) opener.current?.focus()
    opener.current = null
  }, [])

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      const container = containerRef.current
      if (!container) return
      event.preventDefault()
      const box = container.getBoundingClientRect()
      // The keyboard's menu key reports no pointer position: open by the row
      // that has focus instead.
      const fromKeyboard = event.clientX === 0 && event.clientY === 0
      const target = event.target instanceof HTMLElement ? event.target : container
      const anchor = fromKeyboard ? target.getBoundingClientRect() : null
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setPoint({
        x: (anchor ? anchor.left + 24 : event.clientX) - box.left,
        y: (anchor ? anchor.bottom : event.clientY) - box.top
      })
    },
    [containerRef]
  )

  // Turning the setting off folds an open menu.
  if (!quickReorder && point !== null) setPoint(null)

  return { point, onContextMenu: quickReorder ? onContextMenu : undefined, close }
}
