/**
 * JoinConfirmDialog (VRX-210) — the ONE join confirmation control surface.
 * Mounted once in AppShell; fed by the shared useJoinInstance store, so every
 * join path (row pill, drawer Join, and any future surface) funnels here when
 * `settings.confirmJoin` is on.
 *
 * A TRUE modal (aria-modal) — the app's first. Per the owner's ruling it still
 * wears the VRX-225 drawer's SOFT scrim + outside-pointerdown close; DESIGN.md
 * reserves the heavier `--scrim` for true modals, so the scrim choice is
 * flagged for the owner's eyeball rather than silently "upgraded".
 *
 * Visual-weight order (owner-ruled): type-named headline → openness (the
 * safety context) → who's-there → mode → actions. The "More info" expander
 * and the never-show-again control stay quiet footnotes, never peers of the
 * Confirm/Cancel buttons. Focus lands on Cancel (the safe default); Confirm
 * is visually primary but never auto-focused.
 *
 * KNOWN LIMITATION (owner-ruled CVR honesty rule): CvrAdapter degrades an
 * UNKNOWN CVR privacy value to 'invite' (parseCvrPrivacy → most-restrictive),
 * and that degradation is invisible renderer-side — a CVR instance typed
 * 'owner-must-invite' may be genuinely invite-only OR an unread privacy, and
 * this dialog would show "Effectively private" for what is really "unknown".
 * Distinguishing the two needs a main-side flag — routed to the driver; this
 * PR adds NO new IPC. Missing instance data DOES read honestly as
 * "Openness unknown".
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, InstanceInfo, JoinMode, JoinModePreference, Platform } from '@shared/types'
import { resolveWireMode, useJoinInstance } from '../hooks/useJoinInstance'
import { useFriends } from '../queries/friends'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { Avatar } from './Avatar'
import PlatformPill from './PlatformPill'
import SegmentedControl from './SegmentedControl'

/** Same ≤4-then-overflow discipline as the hot-instance card's who's-here. */
const WHO_THERE_MAX_AVATARS = 4

const MODE_VALUES: readonly JoinMode[] = ['vr', 'desktop']
const MODE_LABEL_KEYS: Record<JoinMode, string> = {
  vr: 'joinConfirm.mode.vr',
  desktop: 'joinConfirm.mode.desktop'
}

/** The copy buckets the openness ladder collapses into for this dialog. */
type OpennessCopy =
  'public' | 'friends-plus' | 'private' | 'group-public' | 'group-plus' | 'group-only' | 'unknown'

function opennessCopyFor(instance: InstanceInfo): OpennessCopy {
  // GROUP instances need group-accurate copy: their openness tier says WHO
  // the group opened to (public / friends-of-members / members-only), but
  // "gated by friendship or invites" would be FALSE for members-only — entry
  // is gated by GROUP MEMBERSHIP (a friend-of-someone-inside cannot get in; a
  // group member who is nobody's friend can). VRChat members-only maps to
  // openness 'invite' (parseLocation pin); CVR members-only likewise.
  if (instance.isGroup) {
    if (instance.openness === 'public') return 'group-public'
    if (instance.openness === 'friends-plus') return 'group-plus'
    return 'group-only'
  }
  if (instance.openness === 'public') return 'public'
  if (instance.openness === 'friends-plus') return 'friends-plus'
  if (
    instance.openness === 'friends' ||
    instance.openness === 'invite-plus' ||
    instance.openness === 'invite'
  ) {
    return 'private'
  }
  return 'unknown'
}

/** i18n key for the "Effectively …" safety sentence. Group variants keep the
 *  effectively-public/private framing (group-public/group-plus stay on the
 *  public side) and name the group via the {{group}} interpolation.
 *  Group+ is PLATFORM-SPECIFIC: VRChat's Group+ admits group members plus
 *  friends of whoever is CURRENTLY IN THE INSTANCE, while CVR's
 *  friends-of-members really is "friends of group members". */
function effectivelyKey(copy: OpennessCopy, platform: Platform): string {
  switch (copy) {
    case 'public':
    case 'friends-plus':
      return 'joinConfirm.openness.public'
    case 'private':
      return 'joinConfirm.openness.private'
    case 'group-public':
      return 'joinConfirm.openness.groupPublic'
    case 'group-plus':
      return platform === 'chilloutvr'
        ? 'joinConfirm.openness.groupPlusCvr'
        : 'joinConfirm.openness.groupPlus'
    case 'group-only':
      return 'joinConfirm.openness.groupOnly'
    default:
      return 'joinConfirm.openness.unknown'
  }
}

/** i18n key for the "More info" explainer — per tier where the meaning differs
 *  (group-plus additionally per platform — see effectivelyKey). */
function moreInfoKey(copy: OpennessCopy, platform: Platform): string {
  switch (copy) {
    case 'public':
      return 'joinConfirm.more.public'
    case 'friends-plus':
      return 'joinConfirm.more.friendsPlus'
    case 'private':
      return 'joinConfirm.more.private'
    case 'group-public':
      return 'joinConfirm.more.groupPublic'
    case 'group-plus':
      return platform === 'chilloutvr'
        ? 'joinConfirm.more.groupPlusCvr'
        : 'joinConfirm.more.groupPlus'
    case 'group-only':
      return 'joinConfirm.more.groupOnly'
    default:
      return 'joinConfirm.more.unknown'
  }
}

/** The quiet "will launch in …" line for a CVR friend with an EXPLICIT mode
 *  preference (no picker) — the dialog must say what confirming will do.
 *  Quoted-literal map so the i18n parity scan covers the keys. */
const WILL_LAUNCH_KEYS: Record<Exclude<JoinModePreference, 'ask'>, string> = {
  vr: 'joinConfirm.willLaunch.vr',
  desktop: 'joinConfirm.willLaunch.desktop'
}

/** The pending getInstanceDetails IPC surface (adapter-side today; the bridge
 *  row is routed to the driver — see the PR report). Optional-chained so the
 *  dialog simply omits the total until the surface lands. */
type InstanceDetailsBridge = { getInstanceDetails?: (instanceId: string) => Promise<InstanceInfo> }

export default function JoinConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pendingConfirm, confirmPending, cancelPending } = useJoinInstance()
  const joinMode = useSettingsStore((s) => s.settings.joinMode)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const friend = pendingConfirm
  const instance = friend?.instance ?? null

  // The who's-there row filters the EXISTING friends queries — zero new requests.
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')

  const [mode, setMode] = useState<JoinMode>('desktop')
  const [moreOpen, setMoreOpen] = useState(false)
  const [peopleCount, setPeopleCount] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)

  // Reset the per-open UI state whenever the dialog (re)opens — the
  // render-phase adjustment pattern (same as FriendDrawer's retained friend),
  // NOT an effect (react-hooks/set-state-in-effect).
  const [openFor, setOpenFor] = useState<Friend | null>(null)
  if (friend !== openFor) {
    setOpenFor(friend)
    setMode('desktop')
    setMoreOpen(false)
    setPeopleCount(null)
  }

  // CVR total occupancy: ONE fetch on open, interactive priority, never polled.
  // Silent on failure or when the bridge surface is absent — the friends row
  // is the substance; the total is a nicety. VRChat has no such surface (the
  // adapter method is a stub + the upstream shape is unverified) — never called.
  useEffect(() => {
    if (friend?.platform !== 'chilloutvr' || instance === null) return
    const getDetails = (window.vrx as InstanceDetailsBridge | undefined)?.getInstanceDetails
    if (typeof getDetails !== 'function') return
    let cancelled = false
    getDetails(instance.instanceId)
      .then((info) => {
        if (!cancelled && info.userCount !== null) setPeopleCount(info.userCount)
      })
      .catch(() => {
        /* silent by design — no spinner, no error */
      })
    return () => {
      cancelled = true
    }
  }, [friend, instance])

  // Esc closes; focus lands on Cancel (the SAFE default) and is trapped inside
  // the dialog while it's open; focus returns to whatever opened it on close.
  useEffect(() => {
    if (friend === null) return
    restoreFocusRef.current = document.activeElement
    cancelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        cancelPending()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (panel === null) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first: HTMLElement | undefined = focusables[0]
      const last: HTMLElement | undefined = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) return
      const active = document.activeElement
      if (active === null || !panel.contains(active)) {
        // Focus is OUTSIDE the panel (or nowhere) — the wrap branches below
        // can't match, so pull it back inside. This is what makes the trap a
        // trap: Tab can never walk the background while the modal is open.
        first.focus()
        event.preventDefault()
      } else if (event.shiftKey && active === first) {
        last.focus()
        event.preventDefault()
      } else if (!event.shiftKey && active === last) {
        first.focus()
        event.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to the opener — but NOT if it is gone from the DOM or
      // disabled (Confirm sets the join latch synchronously, and the row pill
      // disables while joining; focusing a disabled button drops to <body>).
      const opener = restoreFocusRef.current
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !(opener instanceof HTMLButtonElement && opener.disabled)
      ) {
        opener.focus({ preventScroll: true })
        return
      }
      // Sensible container fallback: the main landmark (tabIndex -1 in
      // AppShell makes it programmatically focusable).
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    }
  }, [friend, cancelPending])

  if (friend === null) return null

  const isVrc = friend.platform === 'vrchat'
  const typeLabel =
    instance !== null
      ? t(LABEL_KEYS_BY_SCHEME[labelScheme][instance.type] ?? 'friends.instance.unknownWorld')
      : null
  const title =
    typeLabel !== null ? t('joinConfirm.title', { type: typeLabel }) : t('joinConfirm.titleUnknown')
  const worldName = instance?.worldName ?? t('friends.instance.unknownWorld')
  const opennessCopy = instance !== null ? opennessCopyFor(instance) : 'unknown'
  // Color REINFORCES the words (never the sole signifier — R12): the tier-text
  // companion token for known tiers, plain dim for "Openness unknown".
  const opennessColor =
    instance !== null && opennessCopy !== 'unknown'
      ? `var(--op-${instance.openness}-text)`
      : 'var(--text-dim)'
  // Group copy names the group when known ({{group}} interpolation).
  const groupName = instance?.groupName ?? t('joinConfirm.theGroup')

  // Mode: the CVR picker only appears for joinMode 'ask' (research-settled —
  // CVR's deep link genuinely honors startInVR). VRChat can never select a
  // mode over its launch URI, so it gets the honest one-line note instead of
  // a fake control.
  const showModePicker = friend.platform === 'chilloutvr' && joinMode === 'ask'
  const resolvedMode: JoinMode = showModePicker ? mode : resolveWireMode(friend, joinMode)

  // Who's-there: exact worldId + instanceId match over the cached friends.
  const present = [...(vrcFriends.data ?? []), ...(cvrFriends.data ?? [])].filter(
    (f): f is Friend =>
      instance !== null &&
      f.instance !== null &&
      f.instance.worldId === instance.worldId &&
      f.instance.instanceId === instance.instanceId
  )
  const shown = present.slice(0, WHO_THERE_MAX_AVATARS)
  const overflow = present.length - shown.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: present.length,
    names: present.map((f) => f.displayName).join(', ')
  })

  function joinAndNeverAskAgain(): void {
    // Footnote, owner-ruled: saves the setting AND proceeds with this join.
    // Only persist a mode the user actually PICKED here (the CVR picker) —
    // VRChat's resolved mode is a 'desktop' placeholder, and writing it would
    // silently rewrite a CVR user's 'ask' preference from a VRChat dialog.
    updateSettings({ confirmJoin: false, ...(showModePicker ? { joinMode: mode } : {}) })
    void confirmPending(resolvedMode)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[var(--space-6)]">
      {/* Soft scrim (owner-ruled, the VRX-225 pattern) — pure depth; outside
          pointerdown closes like the drawer. */}
      <div
        data-testid="join-confirm-scrim"
        aria-hidden="true"
        onPointerDown={cancelPending}
        className="absolute inset-0 bg-[var(--scrim-soft)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-confirm-title"
        className="glass glass-frosted relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] p-[var(--space-6)]"
      >
        {/* Platform top edge (hot-card recipe) — tint reinforces the PlatformPill
            word; neither carries platform alone (R12). */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[4px] rounded-t-[20px]"
          style={{
            background: isVrc
              ? 'linear-gradient(90deg, var(--vrc), transparent)'
              : 'linear-gradient(90deg, var(--cvr), transparent)'
          }}
        />

        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <h2 id="join-confirm-title" className="text-base font-semibold text-[var(--text)]">
            {title}
          </h2>
          <PlatformPill platform={friend.platform} />
        </div>

        {/* The safety context: world + friend + the effectively-openness sentence. */}
        <p className="text-sm text-[var(--text-dim)]">
          {t('joinConfirm.context', { name: friend.displayName, world: worldName })}
        </p>
        <p className="text-sm font-medium" style={{ color: opennessColor }}>
          {t(effectivelyKey(opennessCopy, friend.platform), { group: groupName })}
        </p>

        {/* Quiet progressive disclosure — an inline expander, not a modal. */}
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className="text-xs text-[var(--text-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
          >
            {t('joinConfirm.moreToggle')}
          </button>
          {moreOpen && (
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
              {t(moreInfoKey(opennessCopy, friend.platform), { group: groupName })}
            </p>
          )}
        </div>

        {/* Who's-there — the substance. A real LIST: the group aria-label
            carries the full names while each avatar's accessible name is the
            friend's display name (never a bare repeated status). ≤4 avatars +
            "+N" (hot-card pattern); the CVR total appears only when the
            one-shot fetch resolves. */}
        {instance !== null && (present.length > 0 || peopleCount !== null) && (
          <div
            role="list"
            aria-label={whoHereAria}
            className="flex items-center gap-[var(--space-2)]"
          >
            {shown.map((f) => (
              <span role="listitem" key={`${f.platform}:${f.platformUserId}`}>
                <Avatar friend={f} ariaLabel={f.displayName} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="shrink-0 text-[13.5px] font-bold text-[var(--text)]">
                {t('dashboard.friendsOverflow', { count: overflow })}
              </span>
            )}
            {peopleCount !== null && (
              <span className="text-xs text-[var(--text-dim)]">
                {t('joinConfirm.peopleCount', { count: peopleCount })}
              </span>
            )}
          </div>
        )}

        {showModePicker ? (
          <SegmentedControl
            values={MODE_VALUES}
            active={mode}
            labelKeys={MODE_LABEL_KEYS}
            ariaLabel={t('joinConfirm.mode.aria')}
            onChange={setMode}
          />
        ) : isVrc ? (
          <p className="text-xs text-[var(--text-faint)]">{t('joinConfirm.vrchatModeNote')}</p>
        ) : (
          // CVR with an explicit preference: no picker, but the dialog still
          // says what confirming will do. ('ask' is the picker branch above.)
          <p className="text-xs text-[var(--text-faint)]">
            {t(WILL_LAUNCH_KEYS[joinMode === 'ask' ? 'desktop' : joinMode])}
          </p>
        )}

        <div className="mt-[var(--space-1)] flex items-center justify-end gap-[var(--space-2)]">
          <button
            ref={cancelRef}
            type="button"
            onClick={cancelPending}
            className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-medium text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
          >
            {t('joinConfirm.cancel')}
          </button>
          {/* Visually primary (the drawer Join recipe) but never auto-focused. */}
          <button
            type="button"
            onClick={() => void confirmPending(resolvedMode)}
            className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]"
            style={{
              borderColor: 'color-mix(in srgb, var(--op-public) 45%, transparent)',
              background: 'color-mix(in srgb, var(--op-public) 16%, transparent)',
              color: 'var(--op-public-text)'
            }}
          >
            {t('joinConfirm.confirm')}
          </button>
        </div>

        {/* Never-show-again FOOTNOTE — deliberately not a peer of the buttons. */}
        <button
          type="button"
          onClick={joinAndNeverAskAgain}
          className="self-center text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        >
          {t('joinConfirm.dontAskAgain')}
        </button>
      </div>
    </div>
  )
}
