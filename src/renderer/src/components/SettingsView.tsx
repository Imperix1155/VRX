import { useTranslation } from 'react-i18next'
import type { Theme } from '@shared/types'
import { THEMES } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

const THEME_LABEL_KEYS: Record<Theme, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
}

/**
 * Settings view (VRX-170). Glass surface hosting per-category rows.
 * Theme row: 3-way segmented control (Dark / Light / System).
 *
 * Persistence note: theme is stored in-memory only — the `get-settings` /
 * `save-settings` IPC channels are not yet wired, so the choice resets on
 * restart. A future change will load/persist via IPC.
 */
export default function SettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.settings.theme)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const activeIndex = THEMES.indexOf(theme)

  return (
    <div className="glass p-[var(--space-8)]">
      <div className="relative">
        {/* ── Appearance section ── */}
        <section aria-labelledby="settings-appearance-heading">
          <h2
            id="settings-appearance-heading"
            className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-[var(--space-6)]"
          >
            {t('settings.appearance.heading')}
          </h2>

          {/* Theme row */}
          <div className="flex items-center justify-between gap-[var(--space-6)]">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">{t('settings.theme.label')}</p>
              <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                {t('settings.theme.description')}
              </p>
            </div>

            {/* Segmented control (§9 pattern). Radius: .glass's 20px panel radius wins
                over any `rounded-[..]` here (see TopBar), so the bubble is rounded-[16px]
                (= 20px − 4px inset) to seat concentrically into the track. */}
            <div
              className="glass relative flex p-[4px] gap-[2px] shrink-0"
              role="group"
              aria-label={t('settings.theme.aria')}
            >
              {/* Sliding bubble */}
              <span
                className="absolute top-[4px] bottom-[4px] rounded-[16px] pointer-events-none motion-safe:transition-transform motion-safe:duration-200"
                style={{
                  width: `calc((100% - 8px - ${THEMES.length - 1} * 2px) / ${THEMES.length})`,
                  transform: `translateX(calc(${activeIndex} * 100% + ${activeIndex} * 2px))`,
                  background: 'var(--seg-bubble-bg)',
                  boxShadow: 'var(--seg-bubble-shadow)'
                }}
                aria-hidden="true"
              />
              {THEMES.map((t_value) => (
                <button
                  key={t_value}
                  type="button"
                  onClick={() => updateSettings({ theme: t_value })}
                  aria-pressed={theme === t_value}
                  className={[
                    'relative z-10 flex-1 text-[12.5px] font-semibold px-[13px] py-[6px] rounded-[9px]',
                    'border-0 bg-transparent cursor-pointer motion-safe:transition-colors',
                    theme === t_value ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
                  ].join(' ')}
                >
                  {t(THEME_LABEL_KEYS[t_value])}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
