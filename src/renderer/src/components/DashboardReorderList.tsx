/**
 * The Dashboard while reorder mode is on (owner, 2026-11-15): every section as
 * one short row to drag, in place of the sections themselves. Short rows keep
 * the whole list on screen, and a section that is switched off or has nothing
 * to show can still be moved. The order is the same `dashboardSections` list
 * Settings → Dashboard → Sections writes; every move also writes
 * `dashboardSectionOrder` so an older build shows the same order.
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dashboardSectionOrderOf, type DashboardSection } from '@shared/types'
import { useDragReorder } from '../hooks/useDragReorder'
import { useSettingsStore } from '../stores/settings'
import { SECTION_SETTINGS } from '../utils/dashboardSections'
import { GripIcon, ReorderActions } from './ReorderControls'

export default function DashboardReorderList(): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const hintId = useId()
  const sections = useSettingsStore((s) => s.settings.dashboardSections)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [announcement, setAnnouncement] = useState('')
  const { itemProps } = useDragReorder<DashboardSection>({
    items: sections,
    enabled: true,
    onReorder: (next, moved, index) => {
      updateSettings({
        dashboardSections: next,
        dashboardSectionOrder: dashboardSectionOrderOf(next)
      })
      setAnnouncement(
        t('reorder.moved', {
          name: t(SECTION_SETTINGS[moved].labelKey),
          position: index + 1,
          count: next.length
        })
      )
    }
  })

  return (
    <section aria-labelledby={headingId} data-dashboard-reorder="">
      <div className="mx-[2px] mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="canvas-text font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-dim)]"
          >
            {t('reorder.dashboardHeading')}
          </h2>
          <p id={hintId} className="canvas-text text-xs text-[var(--text-dim)]">
            {t('reorder.dashboardHint')}
          </p>
        </div>
        <ReorderActions />
      </div>
      <ol className="flex flex-col gap-[var(--space-2)]">
        {sections.map((section) => {
          const { labelKey, setting } = SECTION_SETTINGS[section]
          const drag = itemProps(section)
          return (
            <li key={section}>
              <button
                type="button"
                aria-describedby={hintId}
                ref={drag?.ref}
                data-dragging={drag?.['data-dragging']}
                data-reorder-item=""
                onPointerDown={drag?.onPointerDown}
                onPointerMove={drag?.onPointerMove}
                onPointerUp={drag?.onPointerUp}
                onPointerCancel={drag?.onPointerCancel}
                onClickCapture={drag?.onClickCapture}
                onKeyDown={drag?.onKeyDown}
                style={drag?.style}
                className="glass glass-layer reorder-item relative flex w-full items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] text-left text-sm font-medium text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
              >
                <span className="min-w-0 truncate">{t(labelKey)}</span>
                {/* A section that is switched off can still be moved; say so in a word. */}
                {settings[setting] ? null : (
                  <span className="glass-chip shrink-0 rounded-full border border-[var(--border)] px-[8px] text-[11px] leading-[18px] font-semibold text-[var(--text-dim)]">
                    {t('reorder.sectionOff')}
                  </span>
                )}
                <GripIcon className="ml-auto text-[var(--text-faint)]" />
              </button>
            </li>
          )
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}
