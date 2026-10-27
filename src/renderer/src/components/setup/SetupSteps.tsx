import { forwardRef, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthState, BackgroundGlow, LabelScheme, Platform, Theme } from '@shared/types'
import { BACKGROUND_GLOWS, DASHBOARD_SECTION_ORDERS, LABEL_SCHEMES } from '@shared/types'
import type { Settings } from '@shared/settings'
import { useSettingsStore } from '../../stores/settings'
import { focusRadioSibling, segArrowTarget } from '../../utils/segmented'
import AccountCard from '../AccountCard'
import SegmentedControl from '../SegmentedControl'
import Toggle from '../Toggle'
import { IconActivity, IconExplore, IconFriends, IconHot, IconInbox } from '../NavIcons'
import { SECONDARY_BUTTON, SETUP_ALERTS, SETUP_PLATFORMS } from './setupModel'

/**
 * The questions the welcome setup asks (owner, 2026-10-20). Each step edits the
 * real settings directly, so every choice applies the moment it is made and
 * leaving setup early keeps whatever was already picked.
 */

const PLATFORM_LABEL_KEYS: Record<Platform, string> = {
  vrchat: 'settings.accounts.vrchat.label',
  chilloutvr: 'settings.accounts.chilloutvr.label'
}

const GLOW_LABEL_KEYS: Record<BackgroundGlow, string> = {
  off: 'settings.backgroundGlow.off',
  muted: 'settings.backgroundGlow.muted',
  standard: 'settings.backgroundGlow.standard',
  vivid: 'settings.backgroundGlow.vivid'
}

const SCHEME_LABEL_KEYS: Record<LabelScheme, string> = {
  vrchat: 'settings.labelScheme.vrchat',
  chilloutvr: 'settings.labelScheme.chilloutvr',
  'platform-native': 'settings.labelScheme.platformNative'
}

const ORDER_LABEL_KEYS = {
  'popular-first': 'settings.dashboard.order.popularFirst',
  'hot-first': 'settings.dashboard.order.hotFirst'
} as const

export const StepHeading = forwardRef<
  HTMLHeadingElement,
  { title: string; lead?: string; centered?: boolean; leadLive?: boolean }
>(function StepHeading({ title, lead, centered = false, leadLive = false }, ref) {
  return (
    <div className={centered ? 'text-center' : undefined}>
      {/* Focus lands here on every step change so screen readers announce it. */}
      <h2
        ref={ref}
        id="setup-step-title"
        tabIndex={-1}
        className="text-[22px] font-semibold leading-tight text-[var(--text)] text-balance focus:outline-none"
      >
        {title}
      </h2>
      {lead && (
        <p
          role={leadLive ? 'status' : undefined}
          className={`mt-[var(--space-1)] text-[13px] leading-[1.45] text-[var(--text-dim)]${centered ? ' mx-auto max-w-[44ch] text-balance' : ''}`}
        >
          {lead}
        </p>
      )}
    </div>
  )
})

function RowIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="grid h-[32px] w-[32px] flex-none place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--control-fill)] text-[var(--text)]">
      {children}
    </span>
  )
}

interface RowProps {
  label: string
  description: string
  icon?: React.ReactNode
  children: React.ReactNode
}

/** One labeled control row; `Row` wraps it in its own card. */
function RowContent({ label, description, icon, children }: RowProps): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="flex items-center gap-[var(--space-3)]">
        {icon ? <RowIcon>{icon}</RowIcon> : null}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">{label}</p>
          <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function Row(props: RowProps): React.JSX.Element {
  return (
    <div className="setting-card py-[10px]">
      <RowContent {...props} />
    </div>
  )
}

/** Friend alerts share one card and inbox alerts another, like Settings. */
const ALERT_GROUPS = ['friends', 'inbox'] as const

const FINE_PRINT = 'text-[11.5px] leading-[1.45] text-[var(--text-dim)]'

/**
 * Simple by default, more on demand (owner, 2026-10-22): one short line of
 * fine print that swaps to the full text in place, so opening it adds only a
 * line or two.
 */
function FinePrint({
  summary,
  full,
  centered = false
}: {
  summary: string
  full: string
  centered?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const textId = useId()
  return (
    <p
      id={textId}
      aria-live="polite"
      className={`${FINE_PRINT}${centered ? ' max-w-[52ch] text-center text-balance' : ''}`}
    >
      {open ? full : summary}{' '}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen((value) => !value)}
        className="whitespace-nowrap text-[var(--text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors"
      >
        {t(open ? 'setup.showLess' : 'setup.showMore')}
      </button>
    </p>
  )
}

// ─── Welcome ─────────────────────────────────────────────────────────────────

export const WelcomeStep = forwardRef<HTMLHeadingElement>(function WelcomeStep(_props, ref) {
  const { t } = useTranslation()
  const lines: Array<[React.ReactNode, string, string]> = [
    [<IconFriends key="friends" />, 'setup.welcome.friends.title', 'setup.welcome.friends.body'],
    [<IconHot key="hot" />, 'setup.welcome.hot.title', 'setup.welcome.hot.body'],
    [<IconExplore key="explore" />, 'setup.welcome.explore.title', 'setup.welcome.explore.body']
  ]
  return (
    <div className="flex flex-col items-center gap-[var(--space-3)] pt-[var(--space-2)]">
      {/* Brand mark (DESIGN.md §1: per-letter spans, VT323, platform colors) */}
      <div
        className="inline-flex font-mono text-[64px] leading-none tracking-[2px]"
        role="img"
        aria-label="VRX"
      >
        <span style={{ color: 'var(--vrc)' }}>V</span>
        <span style={{ color: 'var(--bridge)' }}>R</span>
        <span style={{ color: 'var(--cvr)' }}>X</span>
      </div>
      <StepHeading
        ref={ref}
        centered
        title={t('setup.welcome.title')}
        lead={t('setup.welcome.lead')}
      />
      <ul className="my-[var(--space-2)] grid w-full max-w-[420px] gap-[var(--space-2)]">
        {lines.map(([icon, titleKey, bodyKey]) => (
          <li
            key={titleKey}
            className="setting-card flex items-center gap-[var(--space-3)] py-[10px]"
          >
            <RowIcon>{icon}</RowIcon>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13.5px] font-semibold text-[var(--text)]">{t(titleKey)}</span>
              <span className="text-[12.5px] text-[var(--text-dim)]">{t(bodyKey)}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* One line; the full legal text lives in Settings → About → Legal
          (docs/api-policy.md). */}
      <p className={`${FINE_PRINT} max-w-[52ch] text-center text-balance`}>
        {t('shell.unofficialNotice')}
      </p>
    </div>
  )
})

// ─── Sign in ─────────────────────────────────────────────────────────────────

export const SignInStep = forwardRef<HTMLHeadingElement, { skipping: boolean; readyCount: number }>(
  function SignInStep({ skipping, readyCount }, ref) {
    const { t } = useTranslation()
    // The lead doubles as the live status, so the step fits without scrolling
    // once both cards carry the "sign-in from this PC" button.
    const lead =
      readyCount === 0
        ? t(skipping ? 'setup.signin.skipLead' : 'setup.signin.lead')
        : readyCount === 1
          ? t('setup.signin.one')
          : t('setup.signin.both')
    return (
      <div className="flex flex-col gap-[var(--space-3)]">
        <StepHeading ref={ref} title={t('setup.signin.title')} lead={lead} leadLive />
        {/* The same cards as Settings → Accounts: equal size, side by side. */}
        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          {SETUP_PLATFORMS.map((platform) => (
            <AccountCard key={platform} platform={platform} />
          ))}
        </div>
        <FinePrint summary={t('setup.signin.storage')} full={t('setup.signin.storageFull')} />
      </div>
    )
  }
)

// ─── Pages ───────────────────────────────────────────────────────────────────

export const PagesStep = forwardRef<HTMLHeadingElement>(function PagesStep(_props, ref) {
  const { t } = useTranslation()
  const showHot = useSettingsStore((s) => s.settings.showHotInstancesPage)
  const showExplore = useSettingsStore((s) => s.settings.showExplorePage)
  const showActivity = useSettingsStore((s) => s.settings.showActivityPage)
  const showInbox = useSettingsStore((s) => s.settings.showInboxPage)
  const update = useSettingsStore((s) => s.updateSettings)
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <StepHeading ref={ref} title={t('setup.pages.title')} lead={t('setup.pages.lead')} />
      <div className="settings-cards">
        <Row icon={<IconHot />} label={t('shell.nav.hot')} description={t('setup.pages.hot')}>
          <Toggle
            checked={showHot}
            ariaLabel={t('setup.pages.hotAria')}
            onChange={(checked) => update({ showHotInstancesPage: checked })}
          />
        </Row>
        <Row
          icon={<IconActivity />}
          label={t('shell.nav.activity')}
          description={t('setup.pages.activity')}
        >
          <Toggle
            checked={showActivity}
            ariaLabel={t('setup.pages.activityAria')}
            onChange={(checked) => update({ showActivityPage: checked })}
          />
        </Row>
        <Row icon={<IconInbox />} label={t('shell.nav.inbox')} description={t('setup.pages.inbox')}>
          <Toggle
            checked={showInbox}
            ariaLabel={t('setup.pages.inboxAria')}
            onChange={(checked) => update({ showInboxPage: checked })}
          />
        </Row>
        <Row
          icon={<IconExplore />}
          label={t('shell.nav.explore')}
          description={t('setup.pages.explore')}
        >
          <Toggle
            checked={showExplore}
            ariaLabel={t('setup.pages.exploreAria')}
            onChange={(checked) => update({ showExplorePage: checked })}
          />
        </Row>
      </div>
    </div>
  )
})

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const DashboardStep = forwardRef<HTMLHeadingElement>(function DashboardStep(_props, ref) {
  const { t } = useTranslation()
  const popular = useSettingsStore((s) => s.settings.dashboardPopularNow)
  const hot = useSettingsStore((s) => s.settings.hotInstancesEnabled)
  const order = useSettingsStore((s) => s.settings.dashboardSectionOrder)
  const update = useSettingsStore((s) => s.updateSettings)
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <StepHeading ref={ref} title={t('setup.dashboard.title')} lead={t('setup.dashboard.lead')} />
      <div className="settings-cards">
        <Row
          label={t('settings.dashboard.popular.label')}
          description={t('setup.dashboard.popular')}
        >
          <Toggle
            checked={popular}
            ariaLabel={t('setup.dashboard.popularAria')}
            onChange={(checked) => update({ dashboardPopularNow: checked })}
          />
        </Row>
        <Row label={t('settings.dashboard.hot.label')} description={t('setup.dashboard.hot')}>
          <Toggle
            checked={hot}
            ariaLabel={t('setup.dashboard.hotAria')}
            onChange={(checked) => update({ hotInstancesEnabled: checked })}
          />
        </Row>
        {/* The order only matters while both sections show; the saved choice
            is kept either way. */}
        {popular && hot && (
          <Row
            label={t('setup.dashboard.order.label')}
            description={t('setup.dashboard.order.description')}
          >
            <SegmentedControl
              values={DASHBOARD_SECTION_ORDERS}
              active={order}
              labelKeys={ORDER_LABEL_KEYS}
              ariaLabel={t('settings.dashboard.order.aria')}
              onChange={(value) => update({ dashboardSectionOrder: value })}
            />
          </Row>
        )}
      </div>
    </div>
  )
})

// ─── Alerts ──────────────────────────────────────────────────────────────────

export const AlertsStep = forwardRef<HTMLHeadingElement>(function AlertsStep(_props, ref) {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.updateSettings)
  const allOn = SETUP_ALERTS.every((alert) => settings[alert.key])
  const setAll = (on: boolean): void => {
    const patch: Partial<Settings> = {}
    for (const alert of SETUP_ALERTS) patch[alert.key] = on
    update(patch)
  }
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <StepHeading ref={ref} title={t('setup.alerts.title')} lead={t('setup.alerts.lead')} />
      <div className="settings-cards">
        {ALERT_GROUPS.map((group) => (
          <div key={group} className="setting-card grid gap-[var(--space-2)] py-[10px]">
            {SETUP_ALERTS.filter((alert) => alert.group === group).map((alert) => (
              <RowContent key={alert.key} label={t(alert.label)} description={t(alert.description)}>
                <Toggle
                  checked={settings[alert.key]}
                  ariaLabel={t(alert.aria)}
                  onChange={(checked) => update({ [alert.key]: checked })}
                />
              </RowContent>
            ))}
          </div>
        ))}
      </div>
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={() => setAll(!allOn)}>
          {t(allOn ? 'setup.alerts.allOff' : 'setup.alerts.allOn')}
        </button>
      </div>
    </div>
  )
})

// ─── Look ────────────────────────────────────────────────────────────────────

/** A small picture of each theme. Its colors are fixed on purpose: it shows
 *  the theme you would get, not the one showing now. */
function ThemePicture({ mode }: { mode: 'dark' | 'light' }): React.JSX.Element {
  return (
    <span className={`setup-theme-picture setup-theme-picture-${mode}`} aria-hidden="true">
      <span className="setup-theme-picture-side" />
      <span className="setup-theme-picture-main">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}

const THEME_CHOICES: ReadonlyArray<[Theme, string]> = [
  ['system', 'setup.look.system'],
  ['dark', 'settings.theme.dark'],
  ['light', 'settings.theme.light']
]

export const LookStep = forwardRef<HTMLHeadingElement>(function LookStep(_props, ref) {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.settings.theme)
  const glow = useSettingsStore((s) => s.settings.backgroundGlow)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const update = useSettingsStore((s) => s.updateSettings)
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <StepHeading ref={ref} title={t('setup.look.title')} lead={t('setup.look.lead')} />
      {/* Radiogroup + roving tabindex: the house segmented-control dialect. */}
      <div
        role="radiogroup"
        aria-label={t('setup.look.aria')}
        className="grid grid-cols-3 gap-[var(--space-3)]"
      >
        {THEME_CHOICES.map(([value, labelKey], index) => {
          const checked = theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => update({ theme: value })}
              onKeyDown={(e) => {
                const next = segArrowTarget(e.key, index, THEME_CHOICES.length)
                const choice = next === null ? undefined : THEME_CHOICES[next]
                if (next === null || choice === undefined) return
                e.preventDefault()
                update({ theme: choice[0] })
                focusRadioSibling(e.currentTarget, next)
              }}
              className="setup-theme-choice"
            >
              {value === 'system' ? (
                <span className="setup-theme-split">
                  <ThemePicture mode="dark" />
                  <ThemePicture mode="light" />
                </span>
              ) : (
                <ThemePicture mode={value} />
              )}
              <span className="flex items-center gap-[var(--space-2)] px-[2px] pb-[2px] text-[13px] font-semibold">
                {/* The filled dot and the label weight, not color, mark the pick. */}
                <span className="setup-radio" aria-hidden="true" />
                {t(labelKey)}
              </span>
            </button>
          )
        })}
      </div>
      <Row
        label={t('settings.backgroundGlow.label')}
        description={t('settings.backgroundGlow.description')}
      >
        <SegmentedControl
          values={BACKGROUND_GLOWS}
          active={glow}
          labelKeys={GLOW_LABEL_KEYS}
          ariaLabel={t('settings.backgroundGlow.aria')}
          onChange={(value) => update({ backgroundGlow: value })}
        />
      </Row>
      {/* Asked here so new users pick their terms (owner, 2026-10-20); leaving
          setup before this step keeps the VRChat default. */}
      <Row label={t('settings.labelScheme.label')} description={t('setup.look.labelsDescription')}>
        <SegmentedControl
          values={LABEL_SCHEMES}
          active={labelScheme}
          labelKeys={SCHEME_LABEL_KEYS}
          ariaLabel={t('settings.labelScheme.aria')}
          onChange={(value) => update({ labelScheme: value })}
        />
      </Row>
    </div>
  )
})

// ─── Done ────────────────────────────────────────────────────────────────────

export const DoneStep = forwardRef<
  HTMLHeadingElement,
  { authStates: Record<Platform, AuthState | undefined> }
>(function DoneStep({ authStates }, ref) {
  const { t } = useTranslation()
  const s = useSettingsStore((state) => state.settings)

  const accounts = SETUP_PLATFORMS.map((platform) => {
    const state = authStates[platform]
    const name = t(PLATFORM_LABEL_KEYS[platform])
    return t(
      state === 'authenticated'
        ? 'setup.done.connected'
        : state === 'error'
          ? 'setup.done.unreachable'
          : 'setup.done.notConnected',
      { platform: name }
    )
  }).join(' · ')

  // The UI language's own list punctuation ("A, B" in English, "A、B" in Japanese).
  const pages = (
    [
      ['shell.nav.dashboard', true],
      ['shell.nav.hot', s.showHotInstancesPage],
      ['shell.nav.friends', true],
      ['shell.nav.activity', s.showActivityPage],
      ['shell.nav.inbox', s.showInboxPage],
      ['shell.nav.explore', s.showExplorePage],
      ['shell.nav.settings', true]
    ] as const
  )
    .filter(([, shown]) => shown)
    .map(([key]) => t(key))
    .join(t('listSeparator'))

  const sections = [
    s.dashboardPopularNow && t('settings.dashboard.popular.label'),
    s.hotInstancesEnabled && t('settings.dashboard.hot.label')
  ].filter((name): name is string => typeof name === 'string')
  if (sections.length === 2 && s.dashboardSectionOrder === 'hot-first') sections.reverse()
  const [first, second] = sections
  const dashboard =
    first === undefined
      ? t('setup.done.dashboardNone')
      : second === undefined
        ? first
        : t('setup.done.dashboardBoth', { first, second })

  const alertsOn = SETUP_ALERTS.filter((alert) => s[alert.key]).length
  const alerts =
    alertsOn === 0
      ? t('setup.done.alertsOff')
      : t('setup.done.alertsSome', { count: alertsOn, total: SETUP_ALERTS.length })

  const look = t('setup.done.lookValue', {
    theme: t(THEME_CHOICES.find(([value]) => value === s.theme)?.[1] ?? 'setup.look.system'),
    glow: t(GLOW_LABEL_KEYS[s.backgroundGlow])
  })

  const rows: Array<[string, string]> = [
    ['setup.done.accounts', accounts],
    ['setup.done.pages', pages],
    ['setup.done.dashboard', dashboard],
    ['setup.done.alerts', alerts],
    ['setup.done.look', look],
    ['settings.labelScheme.label', t(SCHEME_LABEL_KEYS[s.labelScheme])]
  ]
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <StepHeading ref={ref} title={t('setup.done.title')} lead={t('setup.done.lead')} />
      <dl className="setting-card divide-y divide-[var(--border)] p-0">
        {rows.map(([labelKey, value]) => (
          <div
            key={labelKey}
            className="grid grid-cols-[128px_minmax(0,1fr)] gap-[var(--space-3)] px-[14px] py-[10px] text-[13px]"
          >
            <dt className="font-semibold text-[var(--text-dim)]">{t(labelKey)}</dt>
            <dd className="text-[var(--text)]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
})
