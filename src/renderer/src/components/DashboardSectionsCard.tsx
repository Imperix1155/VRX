/**
 * Settings → Dashboard "Sections" card (owner, 2026-10-27): every section
 * below the Dashboard numbers in its Dashboard order, each with move up/down
 * and an On/Off switch. One card instead of a row per section keeps the page
 * inside the 900x670 window.
 *
 * The list (`dashboardSections`) owns the order; every move also writes
 * `dashboardSectionOrder` so an older build still shows Popular now and Hot
 * Instances in the same order. Edge buttons stay focusable (`aria-disabled`)
 * so a move to the top or bottom never drops keyboard focus.
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '@shared/settings'
import { dashboardSectionOrderOf, type DashboardSection } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import Toggle from './Toggle'

type ShowSetting = keyof Pick<
  Settings,
  'dashboardWearingNow' | 'dashboardInvites' | 'dashboardPopularNow' | 'hotInstancesEnabled'
>

/** Each section's name and the setting that shows it. */
const SECTION_SETTINGS: Readonly<
  Record<DashboardSection, { labelKey: string; setting: ShowSetting }>
> = {
  'wearing-now': {
    labelKey: 'settings.dashboard.wearingNow.label',
    setting: 'dashboardWearingNow'
  },
  invites: { labelKey: 'settings.dashboard.invites.label', setting: 'dashboardInvites' },
  popular: { labelKey: 'settings.dashboard.popular.label', setting: 'dashboardPopularNow' },
  hot: { labelKey: 'settings.dashboard.hot.label', setting: 'hotInstancesEnabled' }
}

export default function DashboardSectionsCard(): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const sections = useSettingsStore((s) => s.settings.dashboardSections)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [announcement, setAnnouncement] = useState('')

  const move = (section: DashboardSection, by: -1 | 1): void => {
    const from = sections.indexOf(section)
    const to = from + by
    if (from < 0 || to < 0 || to >= sections.length) return
    const next = [...sections]
    next.splice(from, 1)
    next.splice(to, 0, section)
    updateSettings({
      dashboardSections: next,
      dashboardSectionOrder: dashboardSectionOrderOf(next)
    })
    setAnnouncement(
      t('settings.dashboard.sections.moved', {
        name: t(SECTION_SETTINGS[section].labelKey),
        position: to + 1,
        count: next.length
      })
    )
  }

  return (
    <div className="setting-card">
      <div>
        <p id={headingId} className="text-sm font-medium text-[var(--text)]">
          {t('settings.dashboard.sections.label')}
        </p>
        <p className="text-xs text-[var(--text-dim)]">
          {t('settings.dashboard.sections.description')}
        </p>
      </div>
      <ol aria-labelledby={headingId} className="setting-children">
        {sections.map((section, index) => {
          const { labelKey, setting } = SECTION_SETTINGS[section]
          const name = t(labelKey)
          return (
            <li key={section} className="setting-row">
              <p className="text-sm text-[var(--text)]">{name}</p>
              <div className="flex shrink-0 items-center gap-[var(--space-2)]">
                <div className="glass flex items-center gap-[2px] p-[4px]">
                  <MoveButton
                    glyph="↑"
                    label={t('settings.dashboard.sections.moveUp', { name })}
                    atEdge={index === 0}
                    onMove={() => move(section, -1)}
                  />
                  <MoveButton
                    glyph="↓"
                    label={t('settings.dashboard.sections.moveDown', { name })}
                    atEdge={index === sections.length - 1}
                    onMove={() => move(section, 1)}
                  />
                </div>
                <Toggle
                  checked={settings[setting]}
                  ariaLabel={name}
                  onChange={(checked) => updateSettings({ [setting]: checked })}
                />
              </div>
            </li>
          )
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/** A round step button, styled like the number stepper's. */
function MoveButton({
  glyph,
  label,
  atEdge,
  onMove
}: {
  glyph: string
  label: string
  atEdge: boolean
  onMove: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={atEdge || undefined}
      onClick={atEdge ? undefined : onMove}
      className={[
        'grid h-[24px] w-[24px] place-items-center rounded-full border-0 text-[13px] font-semibold',
        'bg-[color-mix(in_srgb,var(--text)_8%,transparent)] motion-safe:transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]',
        atEdge
          ? 'text-[var(--text-faint)] cursor-default'
          : 'text-[var(--text)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--text)_14%,transparent)]'
      ].join(' ')}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}
