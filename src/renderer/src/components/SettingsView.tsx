import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BackgroundGlow,
  DashboardSectionOrder,
  DrawerOpener,
  JoinModePreference,
  LabelScheme,
  ReconcileInterval,
  Theme
} from '@shared/types'
import {
  BACKGROUND_GLOWS,
  DASHBOARD_SECTION_ORDERS,
  DRAWER_OPENERS,
  LABEL_SCHEMES,
  RECONCILE_INTERVALS,
  THEMES
} from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useUpdater } from '../hooks/useUpdater'
import { RELEASES_URL } from '@shared/constants'
import AccountCard from './AccountCard'
import NumberStepper from './NumberStepper'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'
import { IconDownload, IconSpinner, IconRestart, IconExternalLink } from './UpdaterIcons'
import type { UpdaterFailure } from '@shared/ipc'

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

const RECONCILE_LABEL_KEYS: Record<ReconcileInterval, string> = {
  '5m': 'settings.reconcileInterval.5m',
  '10m': 'settings.reconcileInterval.10m',
  '30m': 'settings.reconcileInterval.30m',
  manual: 'settings.reconcileInterval.manual'
}

const OPENER_LABEL_KEYS: Record<DrawerOpener, string> = {
  card: 'settings.drawerOpener.card',
  avatar: 'settings.drawerOpener.avatar'
}

// §8 center-neutral rule: 'ask' DEFERS the mode choice to join time, so it
// sits in the middle and the two polar modes flank it. JOIN_MODE_PREFERENCES
// (@shared/types) remains the enum's source of truth — this is display order.
const JOIN_MODE_DISPLAY: readonly JoinModePreference[] = ['vr', 'ask', 'desktop']
const JOIN_MODE_LABEL_KEYS: Record<JoinModePreference, string> = {
  ask: 'settings.joinMode.ask',
  vr: 'settings.joinMode.vr',
  desktop: 'settings.joinMode.desktop'
}

const UPDATER_FAILURE_KEYS: Record<UpdaterFailure, string> = {
  'check-network': 'updater.settings.failure.checkNetwork',
  'download-write': 'updater.settings.failure.downloadWrite',
  'staged-install': 'updater.settings.failure.stagedInstall'
}

/** Keep children mounted for reversible height transitions and saved controls.
 * inert removes every hidden descendant from interaction immediately. */
function SettingCard({
  parent,
  expanded,
  children
}: {
  parent: React.ReactNode
  expanded: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!expanded && content.current?.contains(document.activeElement)) {
      card.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus()
    }
  }, [expanded])
  return (
    <div ref={card} className="setting-card">
      {parent}
      <div
        ref={content}
        className="setting-disclosure"
        data-expanded={expanded}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <div className="setting-disclosure-clip">
          <div className="setting-children">{children}</div>
        </div>
      </div>
    </div>
  )
}

function UpdaterSettingsRow(): React.JSX.Element {
  const { t } = useTranslation()
  const { state, check, download, install, actionFailed } = useUpdater()
  const autoUpdate = useSettingsStore((s) => s.settings.autoUpdate)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleButtonClick = (): void => {
    if (state.state === 'unsupported') {
      void window.vrx?.openUrl({ url: RELEASES_URL })
      return
    }
    if (state.state === 'update-available') {
      void download()
      return
    }
    if (state.state === 'downloaded') {
      void install()
      return
    }
    void check()
  }

  const isChecking = state.state === 'checking'
  const isDownloading = state.state === 'downloading'
  const isDownloaded = state.state === 'downloaded'
  const isUnsupported = state.state === 'unsupported'
  const isUpdateAvailable = state.state === 'update-available'

  const buttonLabel = isUnsupported
    ? t('updater.settings.releases')
    : isChecking
      ? t('updater.settings.checking')
      : isUpdateAvailable
        ? t('updater.settings.updateTo', { version: state.availableVersion ?? '' })
        : isDownloading
          ? state.progressPercent > 0
            ? t('updater.settings.downloading', { percent: state.progressPercent })
            : t('updater.settings.downloadingIndeterminate')
          : isDownloaded
            ? t('updater.settings.restart')
            : t('updater.settings.check')

  const buttonIcon = isUnsupported ? (
    <IconExternalLink />
  ) : isChecking || isDownloading ? (
    <IconSpinner />
  ) : isDownloaded ? (
    <IconRestart />
  ) : (
    <IconDownload />
  )

  const buttonDisabled = isChecking || isDownloading

  return (
    <div className="setting-card setting-row">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{t('updater.settings.label')}</p>
        <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
          {t('updater.settings.description')}
        </p>
        {isUnsupported && (
          <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t('updater.settings.unsupportedNote')}
          </p>
        )}
        {actionFailed && (
          <p role="alert" className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t('updater.settings.actionFailed')}
          </p>
        )}
        {state.failure != null && (
          <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t(UPDATER_FAILURE_KEYS[state.failure])}
          </p>
        )}
        <p className="text-xs text-[var(--text-faint)] mt-[var(--space-0-5)]">
          {t('updater.settings.currentVersion', { version: state.currentVersion })}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        <Toggle
          checked={autoUpdate}
          ariaLabel={t('updater.settings.label')}
          onChange={(checked) => updateSettings({ autoUpdate: checked })}
        />
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={buttonDisabled}
          className={[
            'inline-flex items-center gap-[var(--space-1)]',
            'px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
            'border border-[var(--border)]',
            'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
            'text-[var(--text)]',
            'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
            'cursor-pointer',
            buttonDisabled ? 'opacity-60 cursor-not-allowed' : ''
          ].join(' ')}
        >
          {buttonIcon}
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}

/** Reveal the main-owned log directory (path never crosses the bridge). */
function LogsSettingsRow(): React.JSX.Element {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const openLogs = (): void => {
    setFailed(false)
    const opening = window.vrx?.openLogsFolder?.()
    if (!opening) {
      setFailed(true)
      return
    }
    opening.catch(() => setFailed(true))
  }
  return (
    <div className="setting-card setting-row">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{t('settings.logs.label')}</p>
        <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
          {t('settings.logs.description')}
        </p>
        {failed && (
          <p role="alert" className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t('settings.logs.error')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        <button
          type="button"
          onClick={openLogs}
          className={[
            'inline-flex items-center gap-[var(--space-1)]',
            'px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
            'border border-[var(--border)]',
            'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
            'text-[var(--text)]',
            'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
            'cursor-pointer'
          ].join(' ')}
        >
          {t('settings.logs.open')}
        </button>
      </div>
    </div>
  )
}

/** Category pages with compact cards and retained dependent preferences. */
export default function SettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.settings.theme)
  const backgroundGlow = useSettingsStore((s) => s.settings.backgroundGlow)
  const reconcileInterval = useSettingsStore((s) => s.settings.reconcileInterval)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const drawerOpener = useSettingsStore((s) => s.settings.drawerOpener)
  const popularNow = useSettingsStore((s) => s.settings.dashboardPopularNow)
  const hotEnabled = useSettingsStore((s) => s.settings.hotInstancesEnabled)
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const sectionOrder = useSettingsStore((s) => s.settings.dashboardSectionOrder)
  const allowJoinInstances = useSettingsStore((s) => s.settings.allowJoinInstances)
  const confirmJoin = useSettingsStore((s) => s.settings.confirmJoin)
  const joinMode = useSettingsStore((s) => s.settings.joinMode)
  const notifyFriendOnline = useSettingsStore((s) => s.settings.notifyFriendOnline)
  const notifyFriendInGame = useSettingsStore((s) => s.settings.notifyFriendInGame)
  const notifyFriendOffline = useSettingsStore((s) => s.settings.notifyFriendOffline)
  const notifyHotInstance = useSettingsStore((s) => s.settings.notifyHotInstance)
  const showHotInstancesPage = useSettingsStore((s) => s.settings.showHotInstancesPage)
  const showExplorePage = useSettingsStore((s) => s.settings.showExplorePage)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  // Category mini-pages (VRX-186): one page at a time — Settings never scrolls
  // (§8 no-scroll rule: control surfaces don't scroll, feeds do). The category
  // nav lives in the TopBar's contextual slot (the ONLY selector — no in-panel
  // duplicate, owner rule). Session state, deliberately not persisted.
  const category = useUiStore((s) => s.settingsCategory)

  return (
    <div className="glass glass-information settings-panel p-[var(--space-2)]">
      <div className="relative">
        {/* ── Appearance page ── */}
        {category === 'appearance' && (
          <section className="settings-cards" aria-labelledby="settings-appearance-heading">
            {/* sr-only: the TopBar category nav shows this label visually — a
                visible duplicate reads twice (owner + advisor, VRX-186); the
                heading stays for the section landmark/outline. */}
            <h2 id="settings-appearance-heading" className="sr-only">
              {t('settings.appearance.heading')}
            </h2>

            {/* Theme row */}
            <div className="setting-card setting-row">
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
            <div className="setting-card setting-row">
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
            <div className="setting-card setting-row">
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

            {/* Optional pages (owner, 2026-10-20): hiding a page keeps its
                Dashboard section and alerts. Dashboard, Friends and Settings
                always show. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.pages.hot.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.pages.hot.description')}
                </p>
              </div>
              <Toggle
                checked={showHotInstancesPage}
                ariaLabel={t('settings.pages.hot.label')}
                onChange={(checked) => updateSettings({ showHotInstancesPage: checked })}
              />
            </div>
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.pages.explore.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.pages.explore.description')}
                </p>
              </div>
              <Toggle
                checked={showExplorePage}
                ariaLabel={t('settings.pages.explore.label')}
                onChange={(checked) => updateSettings({ showExplorePage: checked })}
              />
            </div>

            {/* Welcome setup again (owner, 2026-10-20): the wizard replaces the
                shell until it is finished or skipped; nothing else changes. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.setup.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.setup.description')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateSettings({ setupPending: true })}
                className={[
                  'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
                  'border border-[var(--border)]',
                  'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
                  'text-[var(--text)]',
                  'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
                  'cursor-pointer'
                ].join(' ')}
              >
                {t('settings.setup.run')}
              </button>
            </div>
          </section>
        )}

        {category === 'dashboard' && (
          <section className="settings-cards" aria-labelledby="settings-dashboard-heading">
            <h2 id="settings-dashboard-heading" className="sr-only">
              {t('settings.dashboard.heading')}
            </h2>
            {/* Section order (owner, 2026-10-18): the first section shows
                picture cards, the second compact bars. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.dashboard.order.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)]">
                  {t('settings.dashboard.order.description')}
                </p>
              </div>
              <SegmentedControl<DashboardSectionOrder>
                values={DASHBOARD_SECTION_ORDERS}
                active={sectionOrder}
                labelKeys={{
                  'popular-first': 'settings.dashboard.order.popularFirst',
                  'hot-first': 'settings.dashboard.order.hotFirst'
                }}
                ariaLabel={t('settings.dashboard.order.aria')}
                onChange={(value) => updateSettings({ dashboardSectionOrder: value })}
              />
            </div>
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.dashboard.popular.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)]">
                  {t('settings.dashboard.popular.description')}
                </p>
              </div>
              <Toggle
                checked={popularNow}
                ariaLabel={t('settings.dashboard.popular.label')}
                onChange={(checked) => updateSettings({ dashboardPopularNow: checked })}
              />
            </div>
            {/* Dashboard-only: the Hot Instances page and alerts stay available. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.dashboard.hot.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)]">
                  {t('settings.dashboard.hot.description')}
                </p>
              </div>
              <Toggle
                checked={hotEnabled}
                ariaLabel={t('settings.dashboard.hot.label')}
                onChange={(checked) => updateSettings({ hotInstancesEnabled: checked })}
              />
            </div>
            {/* Hot-instance threshold (VRX-78) — its own row so it keeps working
                when the Dashboard section is off. Also quick-adjustable on the
                Dashboard and the Hot Instances page; all write the same setting. */}
            <div className="setting-card setting-row">
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

        {/* ── Behavior page (VRX-231: renamed from the 'dashboard' category;
            session-only key, nothing persisted) ── */}
        {category === 'behavior' && (
          <section className="settings-cards" aria-labelledby="settings-behavior-heading">
            <h2 id="settings-behavior-heading" className="sr-only">
              {t('settings.behavior.heading')}
            </h2>

            {/* Drawer-opener row (VRX-228, moved here from Appearance in
                VRX-231): whole-card pointer opener (default, owner ruling
                2026-07-27) vs the VRX-225 avatar-only behavior. The avatar
                button stays the semantic/keyboard opener either way. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.drawerOpener.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.drawerOpener.description')}
                </p>
              </div>
              <SegmentedControl
                values={DRAWER_OPENERS}
                active={drawerOpener}
                labelKeys={OPENER_LABEL_KEYS}
                ariaLabel={t('settings.drawerOpener.aria')}
                onChange={(value) => updateSettings({ drawerOpener: value })}
              />
            </div>

            {/* Friends background-reconcile row (VRX-77, moved here from
                Appearance in VRX-231) */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.reconcileInterval.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                  {t('settings.reconcileInterval.note')}
                </p>
              </div>
              <SegmentedControl
                values={RECONCILE_INTERVALS}
                active={reconcileInterval}
                labelKeys={RECONCILE_LABEL_KEYS}
                ariaLabel={t('settings.reconcileInterval.aria')}
                onChange={(value) => updateSettings({ reconcileInterval: value })}
              />
            </div>

            <SettingCard
              expanded={allowJoinInstances}
              parent={
                <div className="setting-row">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">
                      {t('settings.allowJoinInstances.label')}
                    </p>
                    <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                      {t('settings.allowJoinInstances.description')}
                    </p>
                  </div>
                  <Toggle
                    checked={allowJoinInstances}
                    ariaLabel={t('settings.allowJoinInstances.aria')}
                    onChange={(checked) => updateSettings({ allowJoinInstances: checked })}
                  />
                </div>
              }
            >
              <div className="setting-row">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {t('settings.confirmJoin.label')}
                  </p>
                  <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                    {t('settings.confirmJoin.description')}
                  </p>
                </div>
                <Toggle
                  checked={confirmJoin}
                  ariaLabel={t('settings.confirmJoin.aria')}
                  onChange={(checked) => updateSettings({ confirmJoin: checked })}
                />
              </div>

              <div className="setting-row">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {t('settings.joinMode.label')}
                  </p>
                  <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                    {t('settings.joinMode.description')}
                  </p>
                </div>
                <SegmentedControl
                  values={JOIN_MODE_DISPLAY}
                  active={joinMode}
                  labelKeys={JOIN_MODE_LABEL_KEYS}
                  ariaLabel={t('settings.joinMode.aria')}
                  onChange={(value) => updateSettings({ joinMode: value })}
                />
              </div>
            </SettingCard>
          </section>
        )}

        {/* ── Notifications page (VRX-84) ── */}
        {category === 'notifications' && (
          <section className="settings-cards" aria-labelledby="settings-notifications-heading">
            <h2 id="settings-notifications-heading" className="sr-only">
              {t('settings.notifications.heading')}
            </h2>

            <div className="setting-card setting-row">
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

            <div className="setting-card setting-row">
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

            <div className="setting-card setting-row">
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

            {/* Hot instance alert — moved here from the Dashboard card (owner,
                2026-10-18); the Dashboard switch no longer gates it. */}
            <div className="setting-card setting-row">
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
          <section className="settings-cards" aria-labelledby="settings-accounts-heading">
            <h2 id="settings-accounts-heading" className="sr-only">
              {t('settings.accounts.heading')}
            </h2>

            <div className="grid grid-cols-2 gap-[var(--space-6)]">
              <AccountCard platform="vrchat" />
              <AccountCard platform="chilloutvr" />
            </div>
            <p className="text-xs text-[var(--text-faint)]">{t('shell.unofficialNotice')}</p>
          </section>
        )}

        {/* ── About page: the app's own upkeep (version, updates, logs). Moved
            out of Behavior so every page fits the default window (§8). ── */}
        {category === 'about' && (
          <section className="settings-cards" aria-labelledby="settings-about-heading">
            <h2 id="settings-about-heading" className="sr-only">
              {t('settings.about.heading')}
            </h2>
            {/* Automatic updates row (VRX-113) */}
            <UpdaterSettingsRow />
            <LogsSettingsRow />
          </section>
        )}
      </div>
    </div>
  )
}
