import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionHealth, Platform } from '@shared/types'
import { SETTINGS_CATEGORIES, useUiStore, type SettingsCategory } from '../stores/ui'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import { useFriends, scopeByPlatformFilter } from '../queries/friends'
import { useAuthStatus } from '../queries/auth'
import { useLinkedProfiles } from '../queries/linkedProfiles'
import { useSegmentedBubble } from '../hooks/useSegmentedBubble'
import { useWindowFocused } from '../hooks/useWindowFocused'
import SegmentedControl from './SegmentedControl'
import { focusRadioSibling, segArrowTarget } from '../utils/segmented'
import { VIEW_TITLE_KEYS } from '../utils/viewTitles'
import { countOnlinePeople } from '../utils/projectLinkedFriends'

// `PlatformFilter` (the segmented control's value type) is the store's canonical
// union — imported, not redefined, so it can't drift (VRX-66). The type import
// and the local `PlatformFilter` component below share a name harmlessly (type
// vs value namespace; `import type` is erased).

// Order: VRChat | All | ChilloutVR — "All" sits in the MIDDLE because it mixes the
// two platforms, so it reads between them (DESIGN.md §8/§9.1). Labels are text-only
// acronyms; the platform color is applied to the WORD itself (no glyph chip).
const SEG_ITEMS: Array<{ id: PlatformFilter; key: string; color: string | null }> = [
  { id: 'vrchat', key: 'shell.seg.vrchatShort', color: 'var(--plat-vrc-word)' },
  { id: 'all', key: 'shell.seg.allShort', color: null },
  { id: 'chilloutvr', key: 'shell.seg.chilloutvrShort', color: 'var(--plat-cvr-word)' }
]

// Category nav labels reuse the settings section-heading keys — one string per
// concept (the sections' h2s are sr-only; this nav is their visible label).
const CATEGORY_LABEL_KEYS: Record<SettingsCategory, string> = {
  appearance: 'settings.appearance.heading',
  dashboard: 'settings.dashboard.heading',
  behavior: 'settings.behavior.heading',
  notifications: 'settings.notifications.heading',
  accounts: 'settings.accounts.heading',
  about: 'settings.about.heading'
}

const STATUS_POLL_MS = 7_500
const HEALTH_LABEL_KEYS: Record<ConnectionHealth, string> = {
  live: 'shell.connection.live',
  reconnecting: 'shell.connection.reconnecting',
  down: 'shell.connection.down'
}

function defaultConnectionHealth(): Record<Platform, ConnectionHealth> {
  return { vrchat: 'down', chilloutvr: 'down' }
}

function parseConnectionHealth(value: unknown): ConnectionHealth {
  return value === 'live' || value === 'reconnecting' || value === 'down' ? value : 'down'
}

// The platform filter is its OWN component so useSegmentedBubble mounts and
// unmounts WITH the track it measures. When the hook lived in TopBar (which
// never unmounts), swapping to Settings left its ResizeObserver watching the
// detached track — the observer fires on detach with width 0 and the bubble
// rendered 0-wide after every Settings round-trip (advisor finding, VRX-186).
// The `platform` STATE stays lifted in TopBar so the selection survives the swap.
function PlatformFilter({
  platform,
  onChange
}: {
  platform: PlatformFilter
  onChange: (next: PlatformFilter) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const activeIndex = SEG_ITEMS.findIndex((s) => s.id === platform)

  // Sliding bubble measured from the active button (labels are unequal widths —
  // the shared hook owns the recipe; also used by SegmentedControl, VRX-183).
  const { trackRef, bubble } = useSegmentedBubble(activeIndex)

  return (
    <>
      {/* Segmented control (§9: one bubble element, never per-button bg).
      Radius: the track carries NO rounded-[..] utility, so .glass's 20px panel
      radius applies (the owner-ratified §3 carve-out); the bubble below is
      rounded-[16px] (= 20px − 4px inset) to seat concentrically. ↻ VRX-225:
      .glass moved into @layer components, so a utility here would now WIN —
      the 20px look survives because we deliberately don't add one. */}
      {/* A11y (audit W5): a segmented control is a single-select group → radiogroup
      semantics with a roving tabindex (one Tab stop; arrows move the selection),
      not N independent toggle buttons announced as pressed/unpressed. */}
      <div
        ref={trackRef}
        className="glass relative flex p-[4px] gap-[2px] ml-[6px]"
        role="radiogroup"
        aria-label={t('shell.seg.aria')}
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
        {SEG_ITEMS.map(({ id, key, color }, index) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={platform === id}
            tabIndex={platform === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => {
              const next = segArrowTarget(e.key, index, SEG_ITEMS.length)
              if (next === null) return
              const target = SEG_ITEMS[next]
              if (target === undefined) return // modulo keeps next in range; narrows the index
              e.preventDefault()
              onChange(target.id)
              focusRadioSibling(e.currentTarget, next)
            }}
            className={[
              'relative z-10 flex-1 text-[12.5px] font-bold uppercase tracking-wide px-[13px] py-[6px] rounded-[9px]',
              'inline-flex items-center justify-center border-0 bg-transparent cursor-pointer',
              'motion-safe:transition-colors',
              // Platform words carry their own color always; "All" is neutral
              // (active = full text, inactive = dim).
              color != null ? '' : platform === id ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
            ].join(' ')}
            style={color != null ? { color } : undefined}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </>
  )
}

export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const settingsCategory = useUiStore((s) => s.settingsCategory)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  // Platform filter lives in the friends VIEW store (VRX-66) so the selection
  // survives view switches AND is readable by FriendsList — it was local state
  // here before, which made the slider cosmetic.
  const platform = useFriendsStore((s) => s.platformFilter)
  const setPlatform = useFriendsStore((s) => s.setPlatformFilter)
  const vrcAuth = useAuthStatus('vrchat').data
  const cvrAuth = useAuthStatus('chilloutvr').data
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')
  const linkedSnapshot = useLinkedProfiles().data
  const [connectionHealth, setConnectionHealthState] = useState(defaultConnectionHealth)
  const windowFocused = useWindowFocused()

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx?.getAppStatus) return
    const getAppStatus = window.vrx.getAppStatus
    let active = true

    // Keep the previous object when nothing changed, so the steady poll below
    // does not re-render the bar (and recount the roster) every few seconds.
    function setConnectionHealth(next: Record<Platform, ConnectionHealth>): void {
      setConnectionHealthState((current) =>
        current.vrchat === next.vrchat && current.chilloutvr === next.chilloutvr ? current : next
      )
    }

    async function refreshStatus(): Promise<void> {
      try {
        const status: unknown = await getAppStatus()
        if (!active) return
        if (typeof status !== 'object' || status === null || !('ws' in status)) {
          setConnectionHealth(defaultConnectionHealth())
          return
        }
        const ws: unknown = status.ws
        if (typeof ws !== 'object' || ws === null) {
          setConnectionHealth(defaultConnectionHealth())
          return
        }
        setConnectionHealth({
          vrchat: parseConnectionHealth('vrchat' in ws ? ws.vrchat : undefined),
          chilloutvr: parseConnectionHealth('chilloutvr' in ws ? ws.chilloutvr : undefined)
        })
      } catch {
        if (active) setConnectionHealth(defaultConnectionHealth())
      }
    }

    void refreshStatus()
    // Local IPC only: this never touches either platform's wire API, so a short
    // fixed interval is safe and keeps reconnect state responsive. A hidden
    // window (closed to the tray) skips it and refreshes as soon as it shows.
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshStatus()
    }, STATUS_POLL_MS)
    const onVisibilityChange = (): void => {
      if (!document.hidden) void refreshStatus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const isSignedIn = (state: string | undefined): boolean =>
    state === 'authenticated' || state === 'error'
  const vrcSignedIn = isSignedIn(vrcAuth?.state)
  const cvrSignedIn = isSignedIn(cvrAuth?.state)
  const countedHealth = [
    ...(vrcSignedIn ? [connectionHealth.vrchat] : []),
    ...(cvrSignedIn ? [connectionHealth.chilloutvr] : [])
  ]
  const worstHealth: ConnectionHealth = countedHealth.includes('down')
    ? 'down'
    : countedHealth.includes('reconnecting')
      ? 'reconnecting'
      : 'live'
  const healthColor =
    worstHealth === 'live'
      ? 'var(--ingame)'
      : worstHealth === 'reconnecting'
        ? 'var(--warning)'
        : 'var(--error)'
  // A saved session waiting for a sign-in code is not signed out.
  const notSignedInLabel = (state: string | undefined): string =>
    t(state === 'needs-2fa' ? 'shell.connection.needsCode' : 'shell.connection.signedOut')
  const connectionLabel = t('shell.connection.label', {
    vrchat: vrcSignedIn
      ? t(HEALTH_LABEL_KEYS[connectionHealth.vrchat])
      : notSignedInLabel(vrcAuth?.state),
    chilloutvr: cvrSignedIn
      ? t(HEALTH_LABEL_KEYS[connectionHealth.chilloutvr])
      : notSignedInLabel(cvrAuth?.state)
  })

  // Real online count for the §8 status indicator. Online = active OR in-game
  // presence (same definition as the dashboard's getDashboardStats). The friends
  // queries are already cached (Friends/Dashboard views), so this re-uses them
  // rather than fetching again. Scoped to the platform filter (VRX-66) so the
  // count reflects whichever platform(s) the user is currently viewing.
  // Memoized on the cached rosters: the Friends-tab count projects the whole
  // roster (unsorted), which must not rerun on unrelated re-renders.
  const vrcData = vrcFriends.data
  const cvrData = cvrFriends.data
  const onlineCount = useMemo(() => {
    if (activeTab === 'friends') {
      return countOnlinePeople({
        friends: [...(vrcData ?? []), ...(cvrData ?? [])],
        profiles: linkedSnapshot?.profiles ?? [],
        accountIds: linkedSnapshot?.accountIds ?? {},
        filter: platform,
        search: ''
      })
    }
    return scopeByPlatformFilter(platform, vrcData, cvrData)
      .flatMap((data) => data ?? [])
      .filter((friend) => friend.presence.state === 'active' || friend.presence.state === 'in-game')
      .length
  }, [activeTab, vrcData, cvrData, linkedSnapshot, platform])

  // Reserve a three-digit cell so the contextual dock stays fixed as the live
  // count changes. Tabular figures and right alignment mirror the
  // NumberStepper's stable value cell. The count is not live: it changes with
  // every friend's presence, and announcing each change would drown out
  // everything else a screen reader says. Connection health is: a drop to
  // reconnecting or down is read out from its own hidden status line.
  const status = (
    <div
      data-testid="topbar-status"
      className="flex min-w-[78px] shrink-0 items-center justify-end gap-[8px] text-right text-[13px] tabular-nums text-[var(--text-dim)]"
    >
      {/* Shape repeats the color for colorblind users: a dot is live, a hollow
          ring is reconnecting, a square is down. The live dot pulses only
          while VRX has focus: an endless animation keeps the window redrawing
          every frame, even behind a game. */}
      <span role="status" className="sr-only">
        {connectionLabel}
      </span>
      <span
        aria-hidden="true"
        data-health={worstHealth}
        className={[
          'box-border w-[8px] h-[8px] flex-none',
          worstHealth === 'down' ? 'rounded-[1px]' : 'rounded-full',
          worstHealth === 'live' && windowFocused ? 'motion-safe:animate-pulse' : ''
        ].join(' ')}
        style={
          worstHealth === 'reconnecting'
            ? { border: `2px solid ${healthColor}`, boxShadow: `0 0 10px ${healthColor}` }
            : { background: healthColor, boxShadow: `0 0 10px ${healthColor}` }
        }
        title={connectionLabel}
      />
      {t('shell.onlineCount', { count: onlineCount })}
    </div>
  )

  return (
    <div
      className={`flex flex-wrap items-center gap-[var(--space-2)] ${activeTab === 'settings' ? 'mb-[var(--space-2)]' : 'mb-[22px]'}`}
    >
      {/* View title */}
      <h1 className="text-[25px] font-extrabold text-[var(--text)] shrink-0">
        {t(VIEW_TITLE_KEYS[activeTab])}
      </h1>

      {activeTab === 'settings' ? (
        <>
          {/* Settings keeps the count on the title row, where every view shows
              it, and gives its six-category nav a row of its own: side by side
              they do not fit the default 900px window (§8). */}
          <div className="ml-auto">{status}</div>
          {/* CONTEXTUAL SLOT (owner, VRX-186): Settings has no use for a
              platform filter, so the settings CATEGORY nav takes its place
              (mini-pages, §8 no-scroll rule). */}
          <div data-testid="topbar-contextual-dock" className="flex basis-full justify-end">
            <SegmentedControl
              values={SETTINGS_CATEGORIES}
              active={settingsCategory}
              labelKeys={CATEGORY_LABEL_KEYS}
              ariaLabel={t('settings.categories.aria')}
              onChange={setSettingsCategory}
            />
          </div>
        </>
      ) : (
        // The contextual control and count share one right dock, so a longer
        // title cannot move either (CONTEXTUAL SLOT, owner, VRX-186: the
        // top-bar control belongs to the active view).
        <div className="ml-auto flex items-center gap-[18px]">
          <div data-testid="topbar-contextual-dock" className="shrink-0">
            <PlatformFilter platform={platform} onChange={setPlatform} />
          </div>
          {status}
        </div>
      )}
    </div>
  )
}
