import { useContext, useEffect, useId, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import type { Platform } from '@shared/types'
import { useAlertPicks, useSetFriendAlert } from '../queries/alertPicks'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import AlertPickRow from './AlertPickRow'
import Toggle from './Toggle'

/** Friend alert kinds in Settings → Notifications order (quoted keys for the
 *  i18n key-existence scan). */
const KINDS = [
  { type: 'online', setting: 'notifyFriendOnline', key: 'drawer.alerts.kinds.online' },
  { type: 'in-game', setting: 'notifyFriendInGame', key: 'drawer.alerts.kinds.inGame' },
  { type: 'offline', setting: 'notifyFriendOffline', key: 'drawer.alerts.kinds.offline' }
] as const

type FriendAlertKind = (typeof KINDS)[number]['type']
const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/** Bell glyph (18×18, stroke 1.8, NavIcons dialect). On adds sound waves and
 *  Off adds a slash, so the state never rests on color alone. */
function BellGlyph({ on }: { on: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px] flex-none overflow-visible"
    >
      <g className="alert-bell-body">
        <path
          d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2Z"
          fill={on ? 'currentColor' : 'none'}
          fillOpacity={on ? 0.18 : 0}
        />
        <path className="alert-bell-clapper" d="M10.2 21a2 2 0 0 0 3.6 0" />
      </g>
      {on ? (
        <g className="alert-bell-waves">
          <path d="M3 9.5a9 9 0 0 1 2.2-4.8" />
          <path d="M21 9.5a9 9 0 0 0-2.2-4.8" />
        </g>
      ) : (
        <path d="M4 4l16 16" />
      )}
    </svg>
  )
}

/**
 * The friend details bell (owner, 2026-10-27): bottom right, across from
 * Identities. It shows whether this friend can alert you, and opens a small
 * panel that springs out of the bell with "Alert me about this friend" while
 * alerts are limited to picked friends, which alerts are on, and a way to
 * Settings → Notifications. Non-modal disclosure: Esc or a press outside
 * folds it, and the drawer closing folds it too.
 */
export default function FriendAlertBell({
  accounts,
  name,
  drawerOpen,
  onLeave
}: {
  accounts: readonly Friend[]
  name: string
  drawerOpen: boolean
  /** Runs before leaving for Settings, so the drawer can save its note. */
  onLeave: () => void
}): React.JSX.Element | null {
  const pickedOnly = useSettingsStore((s) => s.settings.friendAlertScope === 'picked')
  const [open, setOpen] = useState(false)
  if (open && !drawerOpen) setOpen(false)
  if (accounts.length === 0) return null
  return (
    <AlertChoices
      accounts={accounts}
      name={name}
      onLeave={onLeave}
      open={open}
      setOpen={setOpen}
      pickedOnly={pickedOnly}
    />
  )
}

/** The friends list can render this bell before a query client exists. Defaults
 *  match a friend whose choices were never saved: every type on, no bypass. */
function AlertChoices(view: ViewProps): React.JSX.Element {
  const client = useContext(QueryClientContext)
  if (client === undefined) return <Defaults {...view} />
  return <WithPicks {...view} />
}

function Defaults(view: ViewProps): React.JSX.Element {
  return (
    <BellView
      {...view}
      picked={view.pickedOnly ? false : null}
      typeOn={() => true}
      bypassOn={false}
      writable={false}
      saving={false}
      failure={null}
      onType={() => undefined}
      onBypass={() => undefined}
    />
  )
}

interface ViewProps {
  accounts: readonly Friend[]
  name: string
  onLeave: () => void
  open: boolean
  setOpen: (open: boolean) => void
  pickedOnly: boolean
}

function WithPicks(view: ViewProps): React.JSX.Element {
  const vrchat = useAlertPicks('vrchat')
  const chilloutvr = useAlertPicks('chilloutvr')
  const setFriendAlert = useSetFriendAlert()
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const picks = { vrchat, chilloutvr }
  const picked = view.accounts.some((account) =>
    picks[account.platform].picked.has(account.platformUserId)
  )
  const writable = view.accounts.every((account) => picks[account.platform].writable)
  const typeOn = (type: FriendAlertKind): boolean =>
    view.accounts.some((account) => {
      const opted = picks[account.platform].optOuts.get(account.platformUserId)
      return opted === undefined || !opted.has(type)
    })
  const bypassOn = view.accounts.some((account) =>
    picks[account.platform].bypass.has(account.platformUserId)
  )

  const save = async (
    change:
      | { kind: 'type'; type: FriendAlertKind; enabled: boolean }
      | { kind: 'bypass'; enabled: boolean }
  ): Promise<void> => {
    setFailure(null)
    setSaving(true)
    let reason: string | null = null
    for (const platform of PLATFORMS) {
      const ids = view.accounts
        .filter((account) => account.platform === platform)
        .map((account) => account.platformUserId)
      if (ids.length === 0) continue
      reason ??= await setFriendAlert(platform, picks[platform].accountId, ids, change)
    }
    setSaving(false)
    if (reason !== null)
      setFailure(reason === 'full' ? 'drawer.alerts.full' : 'drawer.alerts.saveFailed')
  }

  return (
    <BellView
      {...view}
      picked={view.pickedOnly ? picked : null}
      typeOn={typeOn}
      bypassOn={bypassOn}
      writable={writable}
      saving={saving}
      failure={failure}
      onType={(type, enabled) => void save({ kind: 'type', type, enabled })}
      onBypass={(enabled) => void save({ kind: 'bypass', enabled })}
    />
  )
}

/** `picked` is null while every friend can alert (no picks apply). */
function BellView({
  accounts,
  name,
  onLeave,
  open,
  setOpen,
  pickedOnly,
  picked,
  typeOn,
  bypassOn,
  writable,
  saving,
  failure,
  onType,
  onBypass
}: ViewProps & {
  picked: boolean | null
  typeOn: (type: FriendAlertKind) => boolean
  bypassOn: boolean
  writable: boolean
  saving: boolean
  failure: string | null
  onType: (type: FriendAlertKind, enabled: boolean) => void
  onBypass: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const headingId = useId()

  const hintId = useId()
  const friendCanAlert = KINDS.some((kind) => settings[kind.setting] && typeOn(kind.type))
  const on = friendCanAlert && picked !== false

  // The bell rings when it opens and whenever this friend starts alerting.
  // A new key remounts the glyph, which restarts the CSS animation.
  const [ring, setRing] = useState(0)
  const [wasOn, setWasOn] = useState(on)
  if (on !== wasOn) {
    setWasOn(on)
    if (on) setRing((n) => n + 1)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, setOpen])

  const toggle = (): void => {
    if (!open) setRing((n) => n + 1)
    setOpen(!open)
  }

  const openSettings = (): void => {
    onLeave()
    const ui = useUiStore.getState()
    ui.setSettingsCategory('notifications')
    ui.setActiveTab('settings')
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        // Esc folds the panel first; the drawer's own Esc waits for the next press.
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-alert-bell
        data-on={on}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t(on ? 'drawer.alerts.bellOn' : 'drawer.alerts.bellOff', { name })}
        title={t(on ? 'drawer.alerts.bellOn' : 'drawer.alerts.bellOff', { name })}
        onClick={toggle}
        className="alert-bell glass grid h-[var(--space-8)] w-[var(--space-8)] place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
      >
        <span key={ring} className="alert-bell-glyph grid place-items-center" data-ring={ring > 0}>
          <BellGlyph on={on} />
        </span>
      </button>
      <div
        id={panelId}
        data-alert-panel
        data-open={open}
        inert={!open}
        aria-hidden={!open}
        aria-labelledby={headingId}
        role="group"
        className="alert-bell-panel glass glass-information absolute right-0 bottom-[calc(100%+var(--space-2))] z-20 flex w-[340px] flex-col gap-[var(--space-3)] p-[var(--space-3)]"
      >
        <div className="alert-bell-step flex items-center gap-[var(--space-2)]" style={step(0)}>
          <span className="text-[var(--text-dim)]" aria-hidden="true">
            <BellGlyph on={on} />
          </span>
          <h3
            id={headingId}
            className="text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase"
          >
            {t('drawer.alerts.heading')}
          </h3>
        </div>

        <div className="alert-bell-step" style={step(1)}>
          {pickedOnly ? (
            <AlertPickRow accounts={accounts} name={name} />
          ) : (
            <p className="text-[13px] leading-snug text-[var(--text)]">
              {t('drawer.alerts.everyone')}
            </p>
          )}
        </div>

        <div className="alert-bell-step flex flex-col gap-[var(--space-2)]" style={step(2)}>
          <div
            role="group"
            aria-label={t('drawer.alerts.kinds.label')}
            className="flex flex-wrap gap-[6px]"
          >
            {KINDS.map((kind) => {
              const kindOn = typeOn(kind.type)
              return (
                <button
                  key={kind.setting}
                  type="button"
                  role="checkbox"
                  aria-checked={kindOn}
                  aria-describedby={hintId}
                  aria-label={t('drawer.alerts.kinds.aria', { kind: t(kind.key), name })}
                  data-kind-on={kindOn}
                  disabled={!writable || saving}
                  onClick={() => onType(kind.type, !kindOn)}
                  className="alert-bell-kind glass-chip inline-flex h-[24px] cursor-pointer items-center gap-[5px] rounded-[9px] border bg-transparent px-[var(--space-2)] text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] disabled:cursor-default"
                >
                  <span aria-hidden="true">{kindOn ? '✓' : '–'}</span>
                  {t(kind.key)}
                </button>
              )
            })}
          </div>
          <p id={hintId} className="text-[12px] text-[var(--text-dim)]">
            {t('drawer.alerts.kinds.hint')}
          </p>
          {failure !== null && (
            <p role="alert" className="text-[12px] text-[var(--text-dim)]">
              {t(failure)}
            </p>
          )}
          <div
            className="flex items-center justify-between gap-[var(--space-3)] rounded-control border bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <p className="min-w-0 text-[13px] text-[var(--text)]">
              {t('drawer.alerts.bypass.label')}
            </p>
            <Toggle
              checked={bypassOn}
              disabled={!writable || saving}
              ariaLabel={t('drawer.alerts.bypass.aria', { name })}
              onChange={onBypass}
            />
          </div>
          <button
            type="button"
            onClick={openSettings}
            className="self-start rounded-pill px-[var(--space-1)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)]"
          >
            {t('drawer.alerts.settings')} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** Stagger index for the panel's spring-in, read by `.alert-bell-step`. */
function step(index: number): React.CSSProperties {
  return { '--alert-step': index } as React.CSSProperties
}
