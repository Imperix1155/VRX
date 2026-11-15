/**
 * Settings → Appearance → Sidebar pages → "Order" (owner, 2026-11-15): a small
 * panel with the "Quick reorder" switch, a button that starts reorder mode on
 * the Dashboard, and "Reset order". The switch only decides whether a
 * right-click offers "Reorder"; the button works either way, so the order
 * stays reachable with the switch off.
 *
 * It is a panel behind one button because Appearance has no spare line at
 * 900x670. Non-modal disclosure like the alerts bell: Esc or a press outside
 * folds it.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReorderMode } from '../hooks/useReorderMode'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import Toggle from './Toggle'

const BUTTON_CLASS =
  'rounded-control bg-[var(--control-fill)] px-[var(--space-3)] text-xs cursor-pointer ' +
  'hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] ' +
  'motion-safe:transition-colors'

export default function QuickReorderMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const headingId = useId()
  const noteId = useId()
  const quickReorder = useSettingsStore((s) => s.settings.quickReorder)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const { start, reset, isDefault } = useReorderMode()
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={rootRef}
      // The negative margin keeps the button from making the header line taller.
      className="relative -my-[3px] shrink-0"
      data-quick-reorder=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className={`${BUTTON_CLASS} py-[3px] text-[var(--text-dim)]`}
        onClick={() => setOpen(!open)}
      >
        {t('reorder.setting.open')}
      </button>
      <div
        id={panelId}
        role="group"
        aria-labelledby={headingId}
        data-open={open}
        inert={!open}
        aria-hidden={!open}
        className="alert-bell-panel glass glass-information absolute right-0 bottom-[calc(100%+var(--space-2))] z-20 flex w-[320px] max-w-[calc(100vw-48px)] flex-col gap-[var(--space-3)] p-[var(--space-3)]"
      >
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <div className="min-w-0">
            <p id={headingId} className="text-sm font-medium text-[var(--text)]">
              {t('reorder.setting.label')}
            </p>
            <p id={noteId} className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
              {t('reorder.setting.description')}
            </p>
          </div>
          <Toggle
            checked={quickReorder}
            ariaLabel={t('reorder.setting.label')}
            ariaDescribedBy={noteId}
            onChange={(checked) => updateSettings({ quickReorder: checked })}
          />
        </div>
        <div className="flex items-center gap-[var(--space-2)]">
          <button
            type="button"
            className={`${BUTTON_CLASS} flex-1 py-[var(--space-2)] font-semibold text-[var(--text)]`}
            onClick={() => {
              setOpen(false)
              start()
              useUiStore.getState().setActiveTab('dashboard')
            }}
          >
            {t('reorder.setting.start')}
          </button>
          <button
            type="button"
            title={t('reorder.resetNote')}
            aria-disabled={isDefault || undefined}
            className={`${BUTTON_CLASS} flex-1 py-[var(--space-2)] ${isDefault ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'}`}
            onClick={() => {
              if (isDefault) return
              reset()
              setAnnouncement(t('reorder.resetDone'))
            }}
          >
            {t('reorder.reset')}
          </button>
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  )
}
