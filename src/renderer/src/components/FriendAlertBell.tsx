import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import { useAlertPicks } from '../queries/alertPicks'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import AlertPickRow from './AlertPickRow'

/** Friend alert kinds in Settings → Notifications order (quoted keys for the
 *  i18n key-existence scan). */
const KINDS = [
  { setting: 'notifyFriendOnline', key: 'drawer.alerts.kinds.online' },
  { setting: 'notifyFriendInGame', key: 'drawer.alerts.kinds.inGame' },
  { setting: 'notifyFriendOffline', key: 'drawer.alerts.kinds.offline' }
] as const

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
  const view = { accounts, name, onLeave, open, setOpen }
  // Picks are read only while they decide anything.
  return pickedOnly ? <WithPicks {...view} /> : <BellView {...view} picked={null} />
}

interface ViewProps {
  accounts: readonly Friend[]
  name: string
  onLeave: () => void
  open: boolean
  setOpen: (open: boolean) => void
}

function WithPicks(view: ViewProps): React.JSX.Element {
  const vrchat = useAlertPicks('vrchat')
  const chilloutvr = useAlertPicks('chilloutvr')
  const picks = { vrchat, chilloutvr }
  const picked = view.accounts.some((a) => picks[a.platform].picked.has(a.platformUserId))
  return <BellView {...view} picked={picked} />
}

/** `picked` is null while every friend can alert (no picks apply). */
function BellView({
  accounts,
  name,
  onLeave,
  open,
  setOpen,
  picked
}: ViewProps & { picked: boolean | null }): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const headingId = useId()

  const pickedOnly = picked !== null
  const kindsOn = KINDS.filter((kind) => settings[kind.setting])
  const on = kindsOn.length > 0 && picked !== false

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
          {kindsOn.length === 0 ? (
            <p className="text-[12px] text-[var(--text-dim)]">{t('drawer.alerts.allOff')}</p>
          ) : (
            <ul aria-label={t('drawer.alerts.kinds.label')} className="flex flex-wrap gap-[6px]">
              {KINDS.map((kind) => {
                const kindOn = settings[kind.setting]
                return (
                  <li
                    key={kind.setting}
                    data-kind-on={kindOn}
                    className="alert-bell-kind inline-flex h-[24px] items-center gap-[5px] rounded-[9px] border px-[var(--space-2)] text-[11px] font-semibold"
                  >
                    <span aria-hidden="true">{kindOn ? '✓' : '–'}</span>
                    {t(kind.key)}
                    <span className="sr-only">
                      {t(kindOn ? 'drawer.alerts.kinds.on' : 'drawer.alerts.kinds.off')}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
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
