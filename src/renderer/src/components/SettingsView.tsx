import { useTranslation } from 'react-i18next'
import type { LabelScheme, Theme } from '@shared/types'
import { LABEL_SCHEMES, THEMES } from '@shared/types'
import { useSegmentedBubble } from '../hooks/useSegmentedBubble'
import { useSettingsStore } from '../stores/settings'
import { focusRadioSibling, segArrowTarget } from '../utils/segmented'
import NumberStepper from './NumberStepper'

const THEME_LABEL_KEYS: Record<Theme, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
}

const SCHEME_LABEL_KEYS: Record<LabelScheme, string> = {
  vrchat: 'settings.labelScheme.vrchat',
  chilloutvr: 'settings.labelScheme.chilloutvr',
  'platform-native': 'settings.labelScheme.platformNative'
}

/**
 * Segmented control (§9 pattern) shared by the settings rows. Radius: .glass's
 * 20px panel radius wins over any `rounded-[..]` here (see TopBar), so the
 * bubble is rounded-[16px] (= 20px − 4px inset) to seat concentrically into
 * the track. A11y (audit W5): radiogroup + roving tabindex — one Tab stop,
 * arrows move the selection (same dialect as the TopBar filter).
 */
function SegmentedSetting<T extends string>({
  values,
  active,
  labelKeys,
  ariaLabel,
  onChange
}: {
  values: readonly T[]
  active: T
  labelKeys: Record<T, string>
  ariaLabel: string
  onChange: (value: T) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const activeIndex = values.indexOf(active)

  // Sliding bubble measured from the active button — labels are unequal widths
  // ("VRChat" vs "Per platform"), so the old fixed 1/N-width CSS-calc bubble
  // could not line up (it sat 10.5px off on the theme row's "System").
  const { trackRef, bubble } = useSegmentedBubble(activeIndex)

  return (
    <div
      ref={trackRef}
      className="glass relative flex p-[4px] gap-[2px] shrink-0"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {/* Sliding bubble — left/width measured from the active button (see above) */}
      <span
        className="absolute top-[4px] bottom-[4px] rounded-[16px] pointer-events-none motion-safe:transition-all motion-safe:duration-200"
        style={{
          left: `${bubble.left}px`,
          width: `${bubble.width}px`,
          background: 'var(--seg-bubble-bg)',
          boxShadow: 'var(--seg-bubble-shadow)'
        }}
        aria-hidden="true"
      />
      {values.map((value, index) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={active === value}
          tabIndex={active === value ? 0 : -1}
          onClick={() => onChange(value)}
          onKeyDown={(e) => {
            const next = segArrowTarget(e.key, index, values.length)
            const nextValue = next === null ? undefined : values[next]
            if (next === null || nextValue === undefined) return
            e.preventDefault()
            onChange(nextValue)
            focusRadioSibling(e.currentTarget, next)
          }}
          className={[
            'relative z-10 flex-1 text-[12.5px] font-semibold px-[13px] py-[6px] rounded-[9px]',
            'border-0 bg-transparent cursor-pointer motion-safe:transition-colors whitespace-nowrap',
            active === value ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
          ].join(' ')}
        >
          {t(labelKeys[value])}
        </button>
      ))}
    </div>
  )
}

/**
 * Settings view (VRX-170). Glass surface hosting per-category rows.
 * Theme row: 3-way segmented control (Dark / Light / System).
 * Instance-labels row (VRX-183): pill naming scheme — VRChat terms everywhere
 * (default, the VRX-182 baseline) / ChilloutVR terms everywhere / per-platform
 * native terms. Presentation only: the data stays platform-true.
 *
 * Settings persist across restarts (VRX-184): `useSettingsPersistence` in
 * App.tsx loads them on boot and saves every change through the settings IPC.
 */
export default function SettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.settings.theme)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

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
            <SegmentedSetting
              values={THEMES}
              active={theme}
              labelKeys={THEME_LABEL_KEYS}
              ariaLabel={t('settings.theme.aria')}
              onChange={(value) => updateSettings({ theme: value })}
            />
          </div>

          {/* Instance-labels row (VRX-183) */}
          <div className="mt-[var(--space-6)] flex items-center justify-between gap-[var(--space-6)]">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {t('settings.labelScheme.label')}
              </p>
              <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                {t('settings.labelScheme.description')}
              </p>
            </div>
            <SegmentedSetting
              values={LABEL_SCHEMES}
              active={labelScheme}
              labelKeys={SCHEME_LABEL_KEYS}
              ariaLabel={t('settings.labelScheme.aria')}
              onChange={(value) => updateSettings({ labelScheme: value })}
            />
          </div>
        </section>

        {/* ── Dashboard section ── */}
        <section aria-labelledby="settings-dashboard-heading" className="mt-[var(--space-8)]">
          <h2
            id="settings-dashboard-heading"
            className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-[var(--space-6)]"
          >
            {t('settings.dashboard.heading')}
          </h2>

          {/* Hot-instance threshold row (VRX-78) — also quick-adjustable on the
              Dashboard's hot-instances header; both write the same setting. */}
          <div className="flex items-center justify-between gap-[var(--space-6)]">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {t('settings.hotThreshold.label')}
              </p>
              <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                {t('settings.hotThreshold.description')}
              </p>
            </div>
            <NumberStepper
              value={hotThreshold}
              min={1}
              max={10}
              onChange={(next) => updateSettings({ hotInstanceThreshold: next })}
              ariaLabel={t('settings.hotThreshold.aria')}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
