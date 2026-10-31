import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BackgroundGlow,
  BackgroundPictureFade,
  DrawerOpener,
  FriendAlertScope,
  JoinModePreference,
  LabelScheme,
  ReconcileInterval,
  Theme,
  UpdateChannel,
  VrAlertDuration
} from '@shared/types'
import {
  BACKGROUND_GLOWS,
  BACKGROUND_PICTURE_FADES,
  DRAWER_OPENERS,
  FRIEND_ALERT_SCOPES,
  LABEL_SCHEMES,
  RECONCILE_INTERVALS,
  THEMES,
  UPDATE_CHANNELS,
  VR_ALERT_DURATIONS,
  VRCHAT_OPEN_GAME_JOINS
} from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useUpdater } from '../hooks/useUpdater'
import { ISSUES_URL, releasesUrlFor } from '@shared/constants'
import AccountCard from './AccountCard'
import NumberStepper from './NumberStepper'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'
import DashboardSectionsCard from './DashboardSectionsCard'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'
import { IconDownload, IconSpinner, IconRestart, IconExternalLink } from './UpdaterIcons'
import type { UpdaterFailure } from '@shared/ipc'
import { BackgroundPictureControls, BackgroundPictureMessage } from './BackgroundPicturePicker'
import { useBackgroundPicturePicker } from '../hooks/useBackgroundPicturePicker'
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

/** One row for both open-game settings: Off keeps the saved VRChat choice. */
const OPEN_GAME_CHOICES = [...VRCHAT_OPEN_GAME_JOINS, 'off'] as const
type OpenGameChoice = (typeof OPEN_GAME_CHOICES)[number]
const OPEN_GAME_LABEL_KEYS: Record<OpenGameChoice, string> = {
  go: 'settings.openGameJoin.go',
  invite: 'settings.openGameJoin.invite',
  off: 'settings.openGameJoin.off'
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

/** One labeled On/Off row inside a card. */
function SwitchRow({
  label,
  description,
  ariaLabel,
  checked,
  onChange
}: {
  label: string
  description: string
  ariaLabel: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">{description}</p>
      </div>
      <Toggle checked={checked} ariaLabel={ariaLabel} onChange={onChange} />
    </div>
  )
}

/** Who the friend alerts cover, then those alerts (`scoped`) and, past a
 *  divider, the alerts the scope never limits (`children`), all in one card.
 *  Picked friends are chosen in each friend's details panel; the list behind
 *  Show lets the user review and remove them. */
function FriendAlertsCard({
  scoped,
  children
}: {
  scoped: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const scope = useSettingsStore((s) => s.settings.friendAlertScope)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const vrchat = useAlertPicks('vrchat').picked.size
  const chilloutvr = useAlertPicks('chilloutvr').picked.size
  const [showList, setShowList] = useState(false)
  const picked = scope === 'picked'
  return (
    <>
      <div className="setting-card">
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t('settings.notifications.scope.label')}
            </p>
            {/* Picked friends swaps the explanation for each platform's count
                and Show, so the page still fits the 900x670 window. */}
            {picked ? (
              <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                <span>
                  {t('settings.notifications.picked.description', { vrchat, chilloutvr })}
                </span>{' '}
                <button
                  type="button"
                  onClick={() => setShowList(true)}
                  aria-label={t('settings.notifications.picked.showAria')}
                  className="whitespace-nowrap text-[var(--text)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] cursor-pointer"
                >
                  {t('settings.notifications.picked.show')}
                </button>
              </p>
            ) : (
              <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                {t('settings.notifications.scope.description')}
              </p>
            )}
          </div>
          <SegmentedControl<FriendAlertScope>
            values={FRIEND_ALERT_SCOPES}
            active={scope}
            labelKeys={FRIEND_ALERT_SCOPE_LABEL_KEYS}
            ariaLabel={t('settings.notifications.scope.aria')}
            onChange={(value) => updateSettings({ friendAlertScope: value })}
          />
        </div>
        <div className="mt-[var(--space-2)] grid gap-[var(--space-2)]">{scoped}</div>
        <div className="setting-children">{children}</div>
      </div>
      {showList && <PickedFriendsDialog onClose={() => setShowList(false)} />}
    </>
  )
}

const VR_ALERT_DURATION_LABEL_KEYS: Record<VrAlertDuration, string> = {
  short: 'settings.vrAlerts.duration.short',
  medium: 'settings.vrAlerts.duration.medium',
  long: 'settings.vrAlerts.duration.long'
}

type VrAlertTest = 'idle' | 'sending' | 'sent' | 'failed'

const VR_ALERT_TEST_KEYS: Record<Exclude<VrAlertTest, 'idle'>, string> = {
  sending: 'settings.vrAlerts.test.sending',
  sent: 'settings.vrAlerts.test.sent',
  failed: 'settings.vrAlerts.test.failed'
}

/** The alerts switched on above, also in the VR headset through XSOverlay
 *  (owner, 2026-10-31). Same words and switches for both platforms; main sends
 *  them to this computer only. Time on screen and a test sit under the switch. */
function VrAlertsCard(): React.JSX.Element {
  const { t } = useTranslation()
  const on = useSettingsStore((s) => s.settings.vrOverlayAlerts)
  const duration = useSettingsStore((s) => s.settings.vrOverlayAlertDuration)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [test, setTest] = useState<VrAlertTest>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    },
    []
  )
  const sendTest = (): void => {
    if (test === 'sending') return
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    setTest('sending')
    const settle = (result: VrAlertTest): void => {
      setTest(result)
      resetTimer.current = setTimeout(() => setTest('idle'), 6_000)
    }
    const sending = window.vrx?.testVrAlert?.()
    if (!sending) {
      settle('failed')
      return
    }
    sending.then(
      (result) => settle(result.ok ? 'sent' : 'failed'),
      () => settle('failed')
    )
  }
  return (
    <SettingCard
      expanded={on}
      parent={
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">{t('settings.vrAlerts.label')}</p>
            <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
              {t('settings.vrAlerts.description')}
            </p>
          </div>
          <Toggle
            checked={on}
            ariaLabel={t('settings.vrAlerts.aria')}
            onChange={(checked) => updateSettings({ vrOverlayAlerts: checked })}
          />
        </div>
      }
    >
      <div className="setting-row">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">
            {t('settings.vrAlerts.duration.label')}
          </p>
          <p
            className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]"
            role="status"
            aria-live="polite"
          >
            {test === 'idle' ? (
              <>
                <span>{t('settings.vrAlerts.duration.description')}</span>{' '}
                <button
                  type="button"
                  onClick={sendTest}
                  className="whitespace-nowrap text-[var(--text)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] cursor-pointer"
                >
                  {t('settings.vrAlerts.test.send')}
                </button>
              </>
            ) : (
              t(VR_ALERT_TEST_KEYS[test])
            )}
          </p>
        </div>
        <SegmentedControl<VrAlertDuration>
          values={VR_ALERT_DURATIONS}
          active={duration}
          labelKeys={VR_ALERT_DURATION_LABEL_KEYS}
          ariaLabel={t('settings.vrAlerts.duration.aria')}
          onChange={(value) => updateSettings({ vrOverlayAlertDuration: value })}
        />
      </div>
    </SettingCard>
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

/**
 * Report a bug (owner, 2026-10-28): opens GitHub's bug report form in the
 * browser. Main builds the link and fills in only the version, install type
 * and system; the renderer sends nothing.
 */
function BugReportSettingsRow(): React.JSX.Element {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const openReport = (): void => {
    setFailed(false)
    const opening = window.vrx?.openBugReport?.()
    if (!opening) {
      setFailed(true)
      return
    }
    opening.catch(() => setFailed(true))
  }
  return (
    <div className="setting-card setting-row">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{t('settings.bugReport.label')}</p>
        <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
          {t('settings.bugReport.description')}
        </p>
        {failed && (
          <p role="alert" className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
            {t('settings.bugReport.error')}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={openReport}
        className={[
          'shrink-0 inline-flex items-center gap-[var(--space-1)] whitespace-nowrap',
          'px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
          'border border-[var(--border)]',
          'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
          'text-[var(--text)]',
          'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
          'cursor-pointer'
        ].join(' ')}
      >
        {t('settings.bugReport.open')}
        <IconExternalLink />
      </button>
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
            'inline-flex items-center gap-[var(--space-1)] whitespace-nowrap',
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

/**
 * Background picture (owner, 2026-10-26). The picker (shared with the welcome
 * setup) owns choosing and removing; the fade choice appears once a picture
 * is set.
 */
function BackgroundPictureCard(): React.JSX.Element {
  const { t } = useTranslation()
  const picker = useBackgroundPicturePicker()
  const fade = useSettingsStore((s) => s.settings.backgroundPictureFade)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  return (
    <SettingCard
      expanded={picker.dataUrl !== null}
      parent={
        <div className="setting-row">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t('settings.backgroundPicture.label')}
            </p>
            <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
              {t('settings.backgroundPicture.description')}
            </p>
            <BackgroundPictureMessage picker={picker} />
          </div>
          <BackgroundPictureControls picker={picker} />
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
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const hideEmpty = useSettingsStore((s) => s.settings.dashboardHideEmpty)
  const allowJoinInstances = useSettingsStore((s) => s.settings.allowJoinInstances)
  const confirmJoin = useSettingsStore((s) => s.settings.confirmJoin)
  const joinMode = useSettingsStore((s) => s.settings.joinMode)
  const joinOpenGame = useSettingsStore((s) => s.settings.joinOpenGame)
  const vrchatOpenGameJoin = useSettingsStore((s) => s.settings.vrchatOpenGameJoin)
  const notifyFriendOnline = useSettingsStore((s) => s.settings.notifyFriendOnline)
  const notifyFriendInGame = useSettingsStore((s) => s.settings.notifyFriendInGame)
  const notifyFriendOffline = useSettingsStore((s) => s.settings.notifyFriendOffline)
  const notifyHotInstance = useSettingsStore((s) => s.settings.notifyHotInstance)
  const showHotInstancesPage = useSettingsStore((s) => s.settings.showHotInstancesPage)
  const showExplorePage = useSettingsStore((s) => s.settings.showExplorePage)
  const showActivityPage = useSettingsStore((s) => s.settings.showActivityPage)
  const showInboxPage = useSettingsStore((s) => s.settings.showInboxPage)
  const notifyInvites = useSettingsStore((s) => s.settings.notifyInvites)
  const notifyFriendRequests = useSettingsStore((s) => s.settings.notifyFriendRequests)
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

            {/* The Activity and Inbox page switches (owner, 2026-10-27) live
                here rather than with the other page switches so Behavior and
                Notifications (which gained Alerts in VR) still fit the 900x670
                window. Hiding either keeps its alerts. */}
            <div className="setting-card grid gap-[var(--space-2)]">
              <SwitchRow
                label={t('settings.pages.activity.label')}
                description={t('settings.pages.activity.description')}
                ariaLabel={t('settings.pages.activity.label')}
                checked={showActivityPage}
                onChange={(checked) => updateSettings({ showActivityPage: checked })}
              />
              <SwitchRow
                label={t('settings.pages.inbox.label')}
                description={t('settings.pages.inbox.description')}
                ariaLabel={t('settings.pages.inbox.label')}
                checked={showInboxPage}
                onChange={(checked) => updateSettings({ showInboxPage: checked })}
              />
            </div>
          </section>
        )}

        {category === 'dashboard' && (
          <section className="settings-cards" aria-labelledby="settings-dashboard-heading">
            <h2 id="settings-dashboard-heading" className="sr-only">
              {t('settings.dashboard.heading')}
            </h2>
            {/* Hide empty sections (owner, 2026-10-27): the whole Dashboard
                shifts to what has something to show. */}
            <div className="setting-card setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.dashboard.hideEmpty.label')}
                </p>
                <p className="text-xs text-[var(--text-dim)]">
                  {t('settings.dashboard.hideEmpty.description')}
                </p>
              </div>
              <Toggle
                checked={hideEmpty}
                ariaLabel={t('settings.dashboard.hideEmpty.label')}
                onChange={(checked) => updateSettings({ dashboardHideEmpty: checked })}
              />
            </div>
            {/* Every section's place and On/Off (owner, 2026-10-27). Hiding
                one keeps its page and alerts. */}
            <DashboardSectionsCard />
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

              <div className="setting-row">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {t('settings.openGameJoin.label')}
                  </p>
                  <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
                    {t('settings.openGameJoin.description')}
                  </p>
                </div>
                <SegmentedControl
                  values={OPEN_GAME_CHOICES}
                  active={joinOpenGame ? vrchatOpenGameJoin : 'off'}
                  labelKeys={OPEN_GAME_LABEL_KEYS}
                  ariaLabel={t('settings.openGameJoin.aria')}
                  onChange={(value) =>
                    updateSettings(
                      value === 'off'
                        ? { joinOpenGame: false }
                        : { joinOpenGame: true, vrchatOpenGameJoin: value }
                    )
                  }
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

            {/* Every alert in one card (as in the welcome setup), so the page
                switches below still fit the 900x670 window. Who alerts you
                covers the three friend alerts right under it; the divider sets
                off the alerts it never limits. Each switch stays independent.
                The hot instance alert moved here from the Dashboard card
                (owner, 2026-10-18); the Dashboard switch no longer gates it. */}
            <FriendAlertsCard
              scoped={
                <>
                  <SwitchRow
                    label={t('settings.notifications.online.label')}
                    description={t('settings.notifications.online.description')}
                    ariaLabel={t('settings.notifications.online.aria')}
                    checked={notifyFriendOnline}
                    onChange={(checked) => updateSettings({ notifyFriendOnline: checked })}
                  />
                  <SwitchRow
                    label={t('settings.notifications.inGame.label')}
                    description={t('settings.notifications.inGame.description')}
                    ariaLabel={t('settings.notifications.inGame.aria')}
                    checked={notifyFriendInGame}
                    onChange={(checked) => updateSettings({ notifyFriendInGame: checked })}
                  />
                  <SwitchRow
                    label={t('settings.notifications.offline.label')}
                    description={t('settings.notifications.offline.description')}
                    ariaLabel={t('settings.notifications.offline.aria')}
                    checked={notifyFriendOffline}
                    onChange={(checked) => updateSettings({ notifyFriendOffline: checked })}
                  />
                </>
              }
            >
              <SwitchRow
                label={t('settings.notifications.hotInstance.label')}
                description={t('settings.notifications.hotInstance.description')}
                ariaLabel={t('settings.notifications.hotInstance.aria')}
                checked={notifyHotInstance}
                onChange={(checked) => updateSettings({ notifyHotInstance: checked })}
              />
              {/* Inbox alerts (owner, 2026-10-27): invites and invite requests
                  share one switch; friend requests have their own. */}
              <SwitchRow
                label={t('settings.notifications.invites.label')}
                description={t('settings.notifications.invites.description')}
                ariaLabel={t('settings.notifications.invites.aria')}
                checked={notifyInvites}
                onChange={(checked) => updateSettings({ notifyInvites: checked })}
              />
              <SwitchRow
                label={t('settings.notifications.friendRequests.label')}
                description={t('settings.notifications.friendRequests.description')}
                ariaLabel={t('settings.notifications.friendRequests.aria')}
                checked={notifyFriendRequests}
                onChange={(checked) => updateSettings({ notifyFriendRequests: checked })}
              />
            </FriendAlertsCard>

            {/* Alerts in VR (owner, 2026-10-31): the alerts above, also in
                the headset through XSOverlay. */}
            <VrAlertsCard />
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

        {/* ── About page: the app's own upkeep (version, updates, setup, bug reports, logs). Moved
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
            <BugReportSettingsRow />
            <LogsSettingsRow />
            <LegalSettingsRow />
          </section>
        )}
      </div>
    </div>
  )
}
