import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type {
  BackgroundGlow,
  BackgroundPictureFade,
  DashboardSectionOrder,
  DrawerOpener,
  FriendAlertScope,
  JoinModePreference,
  LabelScheme,
  ReconcileInterval,
  Theme,
  UpdateChannel
} from '@shared/types'
import {
  BACKGROUND_GLOWS,
  BACKGROUND_PICTURE_FADES,
  DASHBOARD_SECTION_ORDERS,
  DRAWER_OPENERS,
  FRIEND_ALERT_SCOPES,
  LABEL_SCHEMES,
  RECONCILE_INTERVALS,
  THEMES,
  UPDATE_CHANNELS
} from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useUpdater } from '../hooks/useUpdater'
import { ISSUES_URL, releasesUrlFor } from '@shared/constants'
import AccountCard from './AccountCard'
import NumberStepper from './NumberStepper'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'
import { IconDownload, IconSpinner, IconRestart, IconExternalLink } from './UpdaterIcons'
import type { AppBackgroundResult, UpdaterFailure } from '@shared/ipc'
import { backgroundPictureWarning, type BackgroundPictureWarning } from '@shared/backgroundPicture'
import { chooseAppBackground, clearAppBackground, useAppBackground } from '../queries/appBackground'
import { useAlertPicks } from '../queries/alertPicks'
import PickedFriendsDialog from './PickedFriendsDialog'

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
  off: 'settings.backgroundGlow.off',
  muted: 'settings.backgroundGlow.muted',
  standard: 'settings.backgroundGlow.standard',
  vivid: 'settings.backgroundGlow.vivid'
}

const PICTURE_FADE_LABEL_KEYS: Record<BackgroundPictureFade, string> = {
  low: 'settings.backgroundPicture.fade.low',
  medium: 'settings.backgroundPicture.fade.medium',
  high: 'settings.backgroundPicture.fade.high'
}

/** A cancelled dialog is not an error. */
const PICTURE_ERROR_KEYS: Record<
  Extract<AppBackgroundResult, { ok: false }>['reason'],
  string | null
> = {
  cancelled: null,
  unsupported: 'settings.backgroundPicture.error.unsupported',
  'too-large': 'settings.backgroundPicture.error.tooLarge',
  'too-small': 'settings.backgroundPicture.error.tooSmall',
  'too-tall': 'settings.backgroundPicture.error.tooTall',
  'too-wide': 'settings.backgroundPicture.error.tooWide',
  unreadable: 'settings.backgroundPicture.error.unreadable',
  'save-failed': 'settings.backgroundPicture.error.saveFailed'
}

const RECONCILE_LABEL_KEYS: Record<ReconcileInterval, string> = {
  '5m': 'settings.reconcileInterval.5m',
  '10m': 'settings.reconcileInterval.10m',
  '30m': 'settings.reconcileInterval.30m',
  '1h': 'settings.reconcileInterval.1h',
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

const FRIEND_ALERT_SCOPE_LABEL_KEYS: Record<FriendAlertScope, string> = {
  everyone: 'settings.notifications.scope.everyone',
  picked: 'settings.notifications.scope.picked'
}

/** Who the friend alerts cover. Picked friends are chosen in each friend's
 *  details panel; the list behind Show lets the user review and remove them. */
function FriendAlertScopeCard(): React.JSX.Element {
  const { t } = useTranslation()
  const scope = useSettingsStore((s) => s.settings.friendAlertScope)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const vrchat = useAlertPicks('vrchat').picked.size
  const chilloutvr = useAlertPicks('chilloutvr').picked.size
  const [showList, setShowList] = useState(false)
  const picked = scope === 'picked'
  return (
    <>
      <SettingCard
        expanded={picked}
        parent={
          <div className="setting-row">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {t('settings.notifications.scope.label')}
              </p>
              <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                {t('settings.notifications.scope.description')}
              </p>
            </div>
            <SegmentedControl<FriendAlertScope>
              values={FRIEND_ALERT_SCOPES}
              active={scope}
              labelKeys={FRIEND_ALERT_SCOPE_LABEL_KEYS}
              ariaLabel={t('settings.notifications.scope.aria')}
              onChange={(value) => updateSettings({ friendAlertScope: value })}
            />
          </div>
        }
      >
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t('settings.notifications.picked.label')}
            </p>
            <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
              {t('settings.notifications.picked.description', { vrchat, chilloutvr })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowList(true)}
            aria-label={t('settings.notifications.picked.showAria')}
            className={[
              'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
              'border border-[var(--border)]',
              'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
              'text-[var(--text)]',
              'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
              'cursor-pointer'
            ].join(' ')}
          >
            {t('settings.notifications.picked.show')}
          </button>
        </div>
      </SettingCard>
      {showList && <PickedFriendsDialog onClose={() => setShowList(false)} />}
    </>
  )
}

const UPDATE_CHANNEL_LABEL_KEYS: Record<UpdateChannel, string> = {
  stable: 'updater.settings.channel.stable',
  beta: 'updater.settings.channel.beta',
  dev: 'updater.settings.channel.dev'
}

function UpdaterSettingsRow(): React.JSX.Element {
  const { t } = useTranslation()
  const { state, check, download, install, actionFailed } = useUpdater()
  const autoUpdate = useSettingsStore((s) => s.settings.autoUpdate)
  const updateChannel = useSettingsStore((s) => s.settings.updateChannel)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleButtonClick = (): void => {
    if (state.state === 'checking' || state.state === 'downloading') return
    if (state.state === 'unsupported') {
      void window.vrx?.openUrl({ url: releasesUrlFor(__APP_VERSION__) })
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
  const buttonDisabled = isChecking || isDownloading

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

  return (
    <div className="setting-card grid gap-[var(--space-2)]">
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
        <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
          {t('updater.settings.currentVersion', { version: state.currentVersion })}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        <SegmentedControl
          values={UPDATE_CHANNELS}
          active={updateChannel}
          labelKeys={UPDATE_CHANNEL_LABEL_KEYS}
          ariaLabel={t('updater.settings.channel.aria')}
          onChange={(value) => updateSettings({ updateChannel: value })}
        />
        <Toggle
          checked={autoUpdate}
          ariaLabel={t('updater.settings.label')}
          onChange={(checked) => updateSettings({ autoUpdate: checked })}
        />
        <button
          type="button"
          onClick={handleButtonClick}
          // aria-disabled keeps keyboard focus on the button while it works.
          aria-disabled={buttonDisabled || undefined}
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

const LEGAL_SECTIONS = [
  {
    title: 'settings.legal.officialTitle',
    body: ['settings.legal.independent', 'settings.legal.vrchat', 'settings.legal.chilloutvr']
  },
  { title: 'settings.legal.helpTitle', body: ['settings.legal.support'], report: true },
  { title: 'settings.legal.termsTitle', body: ['settings.legal.terms'] },
  { title: 'settings.legal.privacyTitle', body: ['settings.legal.privacy'] },
  { title: 'settings.legal.licenseTitle', body: ['settings.legal.license'] }
] as const

/**
 * Legal (owner, 2026-10-23): closed by default, opens in place. Carries
 * ChilloutVR's required sentence word for word and a matching VRChat one
 * (docs/api-policy.md); the short notice elsewhere stays one line.
 */
function LegalSettingsRow(): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const button = [
    'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
    'border border-[var(--border)]',
    'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
    'text-[var(--text)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
    'cursor-pointer'
  ].join(' ')
  return (
    <SettingCard
      expanded={open}
      parent={
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">{t('settings.legal.label')}</p>
            <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
              {t('settings.legal.description')}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className={button}
          >
            {t(open ? 'settings.legal.hide' : 'settings.legal.show')}
          </button>
        </div>
      }
    >
      <div id={panelId} className="grid gap-[var(--space-3)]">
        {LEGAL_SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-[var(--text)]">{t(section.title)}</h3>
            {section.body.map((key) => (
              <p key={key} className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                {t(key)}
              </p>
            ))}
            {'report' in section && (
              <button
                type="button"
                onClick={() => void window.vrx?.openUrl({ url: ISSUES_URL })}
                className={`${button} mt-[var(--space-2)] inline-flex items-center gap-[var(--space-1)]`}
              >
                {t('settings.legal.report')}
                <IconExternalLink />
              </button>
            )}
          </div>
        ))}
      </div>
    </SettingCard>
  )
}

const PICTURE_WARNING_KEYS: Record<BackgroundPictureWarning, string> = {
  tall: 'settings.backgroundPicture.warning.tall',
  wide: 'settings.backgroundPicture.warning.wide',
  'low-res': 'settings.backgroundPicture.warning.lowRes'
}

/**
 * Background picture (owner, 2026-10-26): main opens the picture dialog and
 * keeps its own copy; the renderer only ever sees the kept copy's data URL.
 * The fade choice appears once a picture is set. Main refuses pictures that
 * cannot fill the window; a usable picture that will be cropped hard or look
 * soft gets one warning line, read from the thumbnail's own size.
 */
function BackgroundPictureCard(): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data } = useAppBackground()
  const fade = useSettingsStore((s) => s.settings.backgroundPictureFade)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const dataUrl = data?.dataUrl ?? null
  const [fit, setFit] = useState<{ url: string; warning: BackgroundPictureWarning | null } | null>(
    null
  )
  const warning = fit !== null && fit.url === dataUrl ? fit.warning : null
  const button = [
    'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
    'border border-[var(--border)]',
    'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
    'text-[var(--text)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
    busy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
  ].join(' ')

  const choose = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    const result = await chooseAppBackground(queryClient)
    setBusy(false)
    if (!result.ok) setErrorKey(PICTURE_ERROR_KEYS[result.reason])
  }
  const remove = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    const removed = await clearAppBackground(queryClient)
    setBusy(false)
    if (!removed) {
      setErrorKey('settings.backgroundPicture.error.removeFailed')
      return
    }
    // The Remove button is gone now; keep focus in the card.
    chooseButton.current?.focus()
  }

  return (
    <SettingCard
      expanded={dataUrl !== null}
      parent={
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t('settings.backgroundPicture.label')}
            </p>
            <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
              {t('settings.backgroundPicture.description')}
            </p>
            {errorKey !== null && (
              <p role="alert" className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                {t(errorKey)}
              </p>
            )}
            {errorKey === null && warning !== null && (
              <p
                role="status"
                className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]"
                data-testid="background-picture-warning"
              >
                {t(PICTURE_WARNING_KEYS[warning])}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
            {dataUrl !== null && (
              <img
                src={dataUrl}
                alt=""
                className="background-picture-thumb"
                data-testid="background-picture-thumb"
                onLoad={(event) => {
                  const image = event.currentTarget
                  setFit({
                    url: dataUrl,
                    warning: backgroundPictureWarning(image.naturalWidth, image.naturalHeight)
                  })
                }}
              />
            )}
            <button
              ref={chooseButton}
              type="button"
              onClick={() => void choose()}
              aria-disabled={busy || undefined}
              className={button}
            >
              {dataUrl === null
                ? t('settings.backgroundPicture.choose')
                : t('settings.backgroundPicture.change')}
            </button>
            {dataUrl !== null && (
              <button
                type="button"
                onClick={() => void remove()}
                aria-disabled={busy || undefined}
                className={button}
              >
                {t('settings.backgroundPicture.remove')}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="setting-row">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">
            {t('settings.backgroundPicture.fade.label')}
          </p>
          <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t('settings.backgroundPicture.fade.description')}
          </p>
        </div>
        <SegmentedControl
          values={BACKGROUND_PICTURE_FADES}
          active={fade}
          labelKeys={PICTURE_FADE_LABEL_KEYS}
          ariaLabel={t('settings.backgroundPicture.fade.aria')}
          onChange={(value) => updateSettings({ backgroundPictureFade: value })}
        />
      </div>
    </SettingCard>
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
  const showActivityPage = useSettingsStore((s) => s.settings.showActivityPage)
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

            <BackgroundPictureCard />

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

            {/* Optional pages (owner, 2026-10-20; moved here from Appearance):
                hiding a page keeps its Dashboard section and alerts. Dashboard,
                Friends and Settings always show. One card with the
                allow-joining divider keeps Behavior inside the 900x670 window. */}
            <div className="setting-card">
              <div className="setting-row">
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
              <div className="setting-children">
                <div className="setting-row">
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
              </div>
            </div>

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

            <FriendAlertScopeCard />

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

            {/* The Activity page lists the same friend changes inside VRX
                (owner, 2026-10-27). It lives here rather than with the other
                page switches so Behavior still fits the 900x670 window. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.pages.activity.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                  {t('settings.pages.activity.description')}
                </p>
              </div>
              <Toggle
                checked={showActivityPage}
                ariaLabel={t('settings.pages.activity.label')}
                onChange={(checked) => updateSettings({ showActivityPage: checked })}
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
            <p className="text-xs text-[var(--text-dim)]">{t('shell.unofficialNotice')}</p>
          </section>
        )}

        {/* ── About page: the app's own upkeep (version, updates, setup, logs). Moved
            out of Behavior so every page fits the default window (§8). ── */}
        {category === 'about' && (
          <section className="settings-cards" aria-labelledby="settings-about-heading">
            <h2 id="settings-about-heading" className="sr-only">
              {t('settings.about.heading')}
            </h2>
            {/* Automatic updates row (VRX-113) */}
            <UpdaterSettingsRow />
            {/* Welcome setup again (owner, 2026-10-20; moved here from
                Appearance): the wizard replaces the shell until it is finished
                or skipped; nothing else changes. */}
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
            <LogsSettingsRow />
            <LegalSettingsRow />
          </section>
        )}
      </div>
    </div>
  )
}
