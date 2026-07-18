import { useTranslation } from 'react-i18next'
import type { BackgroundGlow, LabelScheme, Theme } from '@shared/types'
import { BACKGROUND_GLOWS, LABEL_SCHEMES, THEMES } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import AccountCard from './AccountCard'
import NumberStepper from './NumberStepper'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'

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

const GLOW_LABEL_KEYS: Record<BackgroundGlow, string> = {
  muted: 'settings.backgroundGlow.muted',
  standard: 'settings.backgroundGlow.standard',
  vivid: 'settings.backgroundGlow.vivid'
}

/**
 * Settings view (VRX-170). Glass surface hosting per-category rows.
 * Theme row: 3-way segmented control (Dark / System / Light — §8 center-neutral rule).
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
  const backgroundGlow = useSettingsStore((s) => s.settings.backgroundGlow)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const notifyFriendOnline = useSettingsStore((s) => s.settings.notifyFriendOnline)
  const notifyFriendInGame = useSettingsStore((s) => s.settings.notifyFriendInGame)
  const notifyFriendOffline = useSettingsStore((s) => s.settings.notifyFriendOffline)
  const notifyHotInstance = useSettingsStore((s) => s.settings.notifyHotInstance)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  // Category mini-pages (VRX-186): one page at a time — Settings never scrolls
  // (§8 no-scroll rule: control surfaces don't scroll, feeds do). The category
  // nav lives in the TopBar's contextual slot (the ONLY selector — no in-panel
  // duplicate, owner rule). Session state, deliberately not persisted.
  const category = useUiStore((s) => s.settingsCategory)

  return (
    <div className="glass p-[var(--space-8)]">
      <div className="relative">
        {/* ── Appearance page ── */}
        {category === 'appearance' && (
          <section aria-labelledby="settings-appearance-heading">
            {/* sr-only: the TopBar category nav shows this label visually — a
                visible duplicate reads twice (owner + advisor, VRX-186); the
                heading stays for the section landmark/outline. */}
            <h2 id="settings-appearance-heading" className="sr-only">
              {t('settings.appearance.heading')}
            </h2>

            {/* Theme row */}
            <div className="flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.theme.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.theme.description')}
                </p>
              </div>
              <SegmentedControl
                values={THEMES}
                active={theme}
                labelKeys={THEME_LABEL_KEYS}
                ariaLabel={t('settings.theme.aria')}
                onChange={(value) => updateSettings({ theme: value })}
              />
            </div>

            {/* Background-glow row (owner-ratified 2026-07-17) */}
            <div className="mt-[var(--space-6)] flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.backgroundGlow.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.backgroundGlow.description')}
                </p>
              </div>
              <SegmentedControl
                values={BACKGROUND_GLOWS}
                active={backgroundGlow}
                labelKeys={GLOW_LABEL_KEYS}
                ariaLabel={t('settings.backgroundGlow.aria')}
                onChange={(value) => updateSettings({ backgroundGlow: value })}
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
              <SegmentedControl
                values={LABEL_SCHEMES}
                active={labelScheme}
                labelKeys={SCHEME_LABEL_KEYS}
                ariaLabel={t('settings.labelScheme.aria')}
                onChange={(value) => updateSettings({ labelScheme: value })}
              />
            </div>
          </section>
        )}

        {/* ── Dashboard page ── */}
        {category === 'dashboard' && (
          <section aria-labelledby="settings-dashboard-heading">
            <h2 id="settings-dashboard-heading" className="sr-only">
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
                min={HOT_INSTANCE_THRESHOLD_MIN}
                max={HOT_INSTANCE_THRESHOLD_MAX}
                onChange={(next) => updateSettings({ hotInstanceThreshold: next })}
                ariaLabel={t('settings.hotThreshold.aria')}
              />
            </div>
          </section>
        )}

        {/* ── Notifications page (VRX-84) ── */}
        {category === 'notifications' && (
          <section aria-labelledby="settings-notifications-heading">
            <h2 id="settings-notifications-heading" className="sr-only">
              {t('settings.notifications.heading')}
            </h2>

            <div className="flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.notifications.online.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                  {t('settings.notifications.online.description')}
                </p>
              </div>
              <Toggle
                checked={notifyFriendOnline}
                ariaLabel={t('settings.notifications.online.aria')}
                onChange={(checked) => updateSettings({ notifyFriendOnline: checked })}
              />
            </div>

            <div className="mt-[var(--space-6)] flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.notifications.inGame.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                  {t('settings.notifications.inGame.description')}
                </p>
              </div>
              <Toggle
                checked={notifyFriendInGame}
                ariaLabel={t('settings.notifications.inGame.aria')}
                onChange={(checked) => updateSettings({ notifyFriendInGame: checked })}
              />
            </div>

            <div className="mt-[var(--space-6)] flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.notifications.offline.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                  {t('settings.notifications.offline.description')}
                </p>
              </div>
              <Toggle
                checked={notifyFriendOffline}
                ariaLabel={t('settings.notifications.offline.aria')}
                onChange={(checked) => updateSettings({ notifyFriendOffline: checked })}
              />
            </div>

            <div className="mt-[var(--space-6)] flex items-center justify-between gap-[var(--space-6)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.notifications.hotInstance.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                  {t('settings.notifications.hotInstance.description')}
                </p>
              </div>
              <Toggle
                checked={notifyHotInstance}
                ariaLabel={t('settings.notifications.hotInstance.aria')}
                onChange={(checked) => updateSettings({ notifyHotInstance: checked })}
              />
            </div>
          </section>
        )}

        {/* ── Accounts page (VRX-37) ── */}
        {category === 'accounts' && (
          <section aria-labelledby="settings-accounts-heading">
            <h2 id="settings-accounts-heading" className="sr-only">
              {t('settings.accounts.heading')}
            </h2>

            <div className="grid grid-cols-2 gap-[var(--space-6)]">
              <AccountCard platform="vrchat" />
              <AccountCard platform="chilloutvr" />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
