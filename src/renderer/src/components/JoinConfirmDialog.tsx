/**
 * JoinConfirmDialog (VRX-210 + VRX-239/241) — the ONE join confirmation control
 * surface. Mounted once in AppShell; fed by the shared useJoinInstance store, so
 * every join path (row pill, drawer Join, hot-instance card) funnels here when
 * `settings.confirmJoin` is on.
 *
 * A TRUE modal (aria-modal) — the app's first. Per the owner's ruling it still
 * wears the VRX-225 drawer's SOFT scrim + outside-pointerdown close; DESIGN.md
 * reserves the heavier `--scrim` for true modals, so the scrim choice is
 * flagged for the owner's eyeball rather than silently "upgraded".
 *
 * Visual-weight order (owner-ruled): type-named headline → policy space (the
 * moderation context) → who's-there → mode → actions. The "More info" expander
 * and the never-show-again control stay quiet footnotes, never peers of the
 * Confirm/Cancel buttons. Focus lands on Cancel (the safe default); Confirm
 * is visually primary but never auto-focused.
 *
 * VRX-239/241 liveness: the dialog renders from the LIVE friend in the TanStack
 * cache, keyed by platform+platformUserId. Cosmetic updates (userCount,
 * worldName, status) update quietly. If the live friend moves to a different
 * instance, the dialog enters DRIFT state: a notice, Confirm disabled, and a
 * Review action that accepts the new target. If the live friend disappears or
 * becomes non-joinable, the dialog enters UNAVAILABLE state (Cancel only). The
 * modal is inert while a launch IPC is in flight.
 *
 * CVR privacy values that defensive parsing cannot recognize keep their safe
 * invite-shaped degradation but carry `opennessUnknown`; this dialog treats
 * that flag like missing instance data and makes no false privacy claim.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, InstanceInfo, JoinMode, JoinModePreference, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { useFriends } from '../queries/friends'
import { resolveWireMode, useJoinInstance } from '../hooks/useJoinInstance'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { policySpaceFor, type PolicySpace } from '../utils/instancePolicySpace'
import { instancePillFor } from '../utils/instancePill'
import { Avatar } from './Avatar'
import InstancePill from './InstancePill'
import PlatformPill from './PlatformPill'
import PolicySpacePill from './PolicySpacePill'
import SegmentedControl from './SegmentedControl'

/** Same ≤4-then-overflow discipline as the hot-instance card's who's-here. */
const WHO_THERE_MAX_AVATARS = 4

const MODE_VALUES: readonly JoinMode[] = ['vr', 'desktop']
const MODE_LABEL_KEYS: Record<JoinMode, string> = {
  vr: 'joinConfirm.mode.vr',
  desktop: 'joinConfirm.mode.desktop'
}

/** Platform-specific explanatory copy for the same classification as the pill. */
function moreInfoKey(space: PolicySpace, platform: Platform): string {
  if (space === 'public') return 'policySpace.more.public'
  if (space === 'private') {
    return platform === 'vrchat' ? 'policySpace.more.privateVrc' : 'policySpace.more.privateCvr'
  }
  return 'policySpace.more.unknown'
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

/** Focusable descendants of the panel, excluding disabled, aria-disabled, and
 *  hidden controls so the trap never land on an inert element. */
function getFocusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !el.hasAttribute('hidden')
  )
}

export default function JoinConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const {
    pendingConfirm,
    isJoining,
    confirmPending,
    acknowledgePendingTarget,
    cancelPending,
    invalidatePending
  } = useJoinInstance()
  const joinMode = useSettingsStore((s) => s.settings.joinMode)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // The dialog renders from the LIVE friend in the TanStack cache. The waiting
  // guard intentionally reads result.dataUpdatedAt (a render-subscribed field)
  // rather than getQueryState().dataUpdateCount, so an identical-data refetch
  // still re-renders the dialog and lifts the guard.
  const liveQuery = useFriends(pendingConfirm?.platform ?? 'vrchat')
  const dataUpdatedAt = liveQuery.dataUpdatedAt ?? 0

  const liveFriend = pendingConfirm
    ? liveQuery.data?.find((f) => f.platformUserId === pendingConfirm.platformUserId)
    : undefined

  const liveInstance = liveFriend?.instance ?? null
  const liveKey =
    liveInstance !== null && pendingConfirm !== null
      ? hotInstanceKey(pendingConfirm.platform, liveInstance.instanceId, liveInstance.worldId)
      : null

  const isWaiting =
    pendingConfirm !== null &&
    pendingConfirm.awaitingCacheAfter !== null &&
    dataUpdatedAt <= pendingConfirm.awaitingCacheAfter
  const isJoinableLive = liveFriend ? isFriendJoinable(liveFriend) : false
  const isDrift =
    !isWaiting &&
    liveQuery.data !== undefined &&
    !liveQuery.isError &&
    isJoinableLive &&
    liveKey !== null &&
    liveKey !== pendingConfirm?.reviewedTarget.key
  const isUnavailable =
    !isWaiting && (!liveQuery.data || liveQuery.isError || !liveFriend || !isJoinableLive)
  const isInert = isJoining || isWaiting || isDrift || isUnavailable

  // Fallback to the reviewed identity's display name when the live friend is gone.
  const friendForCopy = liveFriend ?? pendingConfirm
  const instanceForCopy = liveInstance
  const isVrc = friendForCopy?.platform === 'vrchat'

  const [mode, setMode] = useState<JoinMode>('desktop')
  const [moreOpen, setMoreOpen] = useState(false)
  const [peopleCount, setPeopleCount] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)
  const lastRequestId = useRef<number | null>(null)
  const fetchedForRequestId = useRef<number | null>(null)
  const launchInitiatedRef = useRef(false)
  const wasOpenRef = useRef(false)

  const isOpen = pendingConfirm !== null

  // Reset the per-open UI state whenever the dialog (re)opens — keyed to
  // requestId, never to Friend object identity (VRX-239). Focus init also runs
  // here exactly once per open so a mid-flight target-changed update (which
  // mutates pendingConfirm but keeps the same requestId) cannot yank focus back
  // to Cancel while the user is reading the drift notice.
  useEffect(() => {
    if (pendingConfirm === null) return
    if (pendingConfirm.requestId === lastRequestId.current) return
    lastRequestId.current = pendingConfirm.requestId
    launchInitiatedRef.current = false
    setMode('desktop')
    setMoreOpen(false)
    setPeopleCount(null)
    fetchedForRequestId.current = null
    restoreFocusRef.current = document.activeElement
    cancelRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirm?.requestId])

  // CVR total occupancy: ONE fetch per open, interactive priority, never polled.
  // Silent on failure or when the bridge surface is absent — the friends row
  // is the substance; the total is a nicety. VRChat has no such surface (the
  // adapter method is a stub + the upstream shape is unverified) — never called.
  useEffect(() => {
    if (pendingConfirm?.platform !== 'chilloutvr' || liveInstance === null) return
    if (fetchedForRequestId.current === pendingConfirm.requestId) return
    const getDetails = (window.vrx as InstanceDetailsBridge | undefined)?.getInstanceDetails
    if (typeof getDetails !== 'function') return
    fetchedForRequestId.current = pendingConfirm.requestId
    let cancelled = false
    getDetails(liveInstance.instanceId)
      .then((info) => {
        if (!cancelled && info.userCount !== null) setPeopleCount(info.userCount)
      })
      .catch(() => {
        /* silent by design — no spinner, no error */
      })
    return () => {
      cancelled = true
    }
  }, [pendingConfirm?.requestId, pendingConfirm?.platform, liveInstance])

  // Track whether THIS dialog session committed a launch; if so, restore focus
  // to the main landmark rather than the opener (the row pill re-enables once
  // the join completes and is no longer the right focus target).
  useEffect(() => {
    if (isJoining && pendingConfirm !== null) launchInitiatedRef.current = true
  }, [isJoining, pendingConfirm])

  // Defensive latch clear: if the dialog is ever unmounted (error boundary,
  // route gate) while a confirmation is parked, or if the platform's identity
  // or auth boundary fires, the global pendingConfirm must not outlive its UI.
  // The callbacks read a ref so the subscription stays stable across renders.
  const pendingConfirmRef = useRef(pendingConfirm)
  useEffect(() => {
    pendingConfirmRef.current = pendingConfirm
  })
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !window.vrx?.onIdentityBoundary ||
      !window.vrx?.onFriendEvent
    ) {
      return
    }
    const unsubscribeIdentity = window.vrx.onIdentityBoundary(({ platform }) => {
      if (pendingConfirmRef.current?.platform === platform) invalidatePending()
    })
    const unsubscribeFriend = window.vrx.onFriendEvent((event) => {
      if (
        event.type === 'auth-invalidated' &&
        event.platform === pendingConfirmRef.current?.platform
      ) {
        invalidatePending()
      }
    })
    return () => {
      unsubscribeIdentity()
      unsubscribeFriend()
      // Use invalidatePending on unmount: a launch may still be settling and
      // cancelPending would leave the latch alive.
      if (pendingConfirmRef.current !== null) invalidatePending()
    }
  }, [invalidatePending])

  // Esc closes; focus is trapped inside the panel while it's open; focus
  // returns to whatever opened it on close. The trap stays active during a
  // launch (the modal is inert but focus must not escape to the background),
  // and disabled/hidden/aria-disabled controls are excluded. This effect is
  // keyed to the OPEN/CLOSE boolean, not to pendingConfirm object identity, so
  // a target-changed mutation cannot reset focus.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false
      // A committed launch should hand focus back to the page, not to the
      // opener that the user already acted on.
      if (launchInitiatedRef.current) {
        document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
        return
      }
      // Restore focus to the opener — but NOT if it is gone from the DOM or
      // disabled.
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
      return
    }

    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        // Escape is ignored while a launch is committed: the modal is inert and
        // Cancel is disabled.
        if (isJoining) return
        cancelPending()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (panel === null) return
      const focusables = getFocusables(panel)
      const first: HTMLElement | undefined = focusables[0]
      const last: HTMLElement | undefined = focusables[focusables.length - 1]
      const active = document.activeElement
      if (
        active === null ||
        !panel.contains(active) ||
        (active !== null && !focusables.some((el) => el === active))
      ) {
        // Focus is OUTSIDE the panel, on a disabled/hidden element, or the
        // panel itself while every control is inert — pull it to a valid anchor.
        const target = first ?? panel
        target.focus({ preventScroll: true })
        event.preventDefault()
      } else if (first !== undefined && last !== undefined) {
        if (event.shiftKey && active === first) {
          last.focus()
          event.preventDefault()
        } else if (!event.shiftKey && active === last) {
          first.focus()
          event.preventDefault()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, isJoining, cancelPending])

  // While a launch is in flight every action control is disabled. Keep focus on
  // a valid anchor (the panel itself when no control is focusable) so Tab can
  // never walk the background.
  useEffect(() => {
    if (!isJoining) return
    const panel = panelRef.current
    if (panel === null) return
    const focusables = getFocusables(panel)
    const active = document.activeElement
    if (focusables.length === 0) {
      panel.focus({ preventScroll: true })
    } else if (active === null || !focusables.includes(active as HTMLElement)) {
      focusables[0]?.focus({ preventScroll: true })
    }
  }, [isJoining])

  if (pendingConfirm === null || friendForCopy == null) return null

  const typeLabel =
    instanceForCopy !== null
      ? t(
          LABEL_KEYS_BY_SCHEME[labelScheme][instanceForCopy.type] ?? 'friends.instance.unknownWorld'
        )
      : null
  const policySpace =
    instanceForCopy !== null ? policySpaceFor(friendForCopy.platform, instanceForCopy) : 'unknown'
  // The pill is resolved independently of the headline (VRX-244): an unknown-
  // openness instance still gets an honest "Unknown" pill rather than being
  // hidden — hiding it would be the same "quietly withhold the truth" failure
  // the truthful-signals law exists to prevent. `instanceForCopy === null`
  // (no live instance data at all) has nothing to resolve, so no pill.
  const pill = instanceForCopy !== null ? instancePillFor(instanceForCopy, labelScheme) : null
  // A degraded CVR privacy flag or missing instance data must not headline a
  // guessed type. A known type may still have an Unknown policy classification
  // (for example CVR Members Only), so policy space does not drive the title.
  const title =
    typeLabel !== null && instanceForCopy?.opennessUnknown !== true
      ? t('joinConfirm.title', { type: typeLabel })
      : t('joinConfirm.titleUnknown')
  const worldName = instanceForCopy?.worldName ?? t('friends.instance.unknownWorld')

  // Mode: the CVR picker only appears for joinMode 'ask' (research-settled —
  // CVR's deep link genuinely honors startInVR). VRChat can never select a
  // mode over its launch URI, so it gets the honest one-line note instead of
  // a fake control.
  const showModePicker = friendForCopy.platform === 'chilloutvr' && joinMode === 'ask'
  const resolvedMode: JoinMode = showModePicker ? mode : resolveWireMode(friendForCopy, joinMode)

  // Who's-there: the SHARED hot-instance derivation (VRX-237) — same platform
  // AND same hotInstanceKey (platform-aware), joinable members only
  // (isFriendJoinable — the owner privacy law hides Ask Me/DND). One
  // derivation with the hot card: the dialog never contradicts the card.
  const parkedKey =
    instanceForCopy !== null
      ? hotInstanceKey(friendForCopy.platform, instanceForCopy.instanceId, instanceForCopy.worldId)
      : null
  const present = [...(liveQuery.data ?? [])].filter(
    (f): f is Friend =>
      parkedKey !== null &&
      f.platform === friendForCopy.platform &&
      isFriendJoinable(f) &&
      hotInstanceKey(f.platform, f.instance?.instanceId ?? null, f.instance?.worldId ?? null) ===
        parkedKey
  )
  const shown = present.slice(0, WHO_THERE_MAX_AVATARS)
  const overflow = present.length - shown.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: present.length,
    names: present.map((f) => f.displayName).join(', ')
  })

  async function joinAndNeverAskAgain(): Promise<void> {
    // Persist the setting ONLY after a successful join — an aborted or
    // drifted confirm must not alter user preferences (VRX-239/241).
    const result = await confirmPending(resolvedMode)
    if (result === 'joined') {
      updateSettings({
        confirmJoin: false,
        ...(showModePicker ? { joinMode: mode } : {})
      })
    }
  }

  function onReview(): void {
    acknowledgePendingTarget(liveKey ?? undefined)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[var(--space-6)]">
      {/* Soft scrim (owner-ruled, the VRX-225 pattern) — pure depth; outside
          pointerdown closes like the drawer, but not while the launch is in
          flight (the modal is inert then). */}
      <div
        data-testid="join-confirm-scrim"
        aria-hidden="true"
        onPointerDown={() => {
          if (!isJoining) cancelPending()
        }}
        className="absolute inset-0 bg-[var(--scrim-soft)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-confirm-title"
        tabIndex={-1}
        className="glass glass-frosted-heavy relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] overflow-hidden p-[var(--space-6)] focus:outline-none"
      >
        {/* Platform top edge (hot-card recipe) — tint reinforces the PlatformPill
            word; neither carries platform alone (R12). */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[4px]"
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
          <div className="flex flex-col items-end gap-[var(--space-1)]">
            <PlatformPill platform={friendForCopy.platform} />
            {pill !== null && <InstancePill label={t(pill.labelKey)} tier={pill.tier} />}
          </div>
        </div>

        {/* World/friend context followed by the independent moderation context. */}
        <p className="text-sm text-[var(--text-dim)]">
          {t('joinConfirm.context', { name: friendForCopy.displayName, world: worldName })}
        </p>
        <div>
          <PolicySpacePill space={policySpace} />
        </div>

        {/* Drift / unavailable / waiting notices — quiet-styled per VRX-245. */}
        {isDrift && (
          <p className="text-sm text-[var(--text-dim)]">
            {t('joinConfirm.driftNotice', { name: friendForCopy.displayName })}
          </p>
        )}
        {isWaiting && <p className="text-sm text-[var(--text-dim)]">{t('joinConfirm.waiting')}</p>}
        {isUnavailable && (
          <p className="text-sm text-[var(--text-dim)]">
            {t('joinConfirm.unavailable', { name: pendingConfirm.displayName })}
          </p>
        )}

        {/* Quiet progressive disclosure — an inline expander, not a modal. */}
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            disabled={isJoining}
            onClick={() => setMoreOpen((open) => !open)}
            className="text-xs text-[var(--text-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.moreToggle')}
          </button>
          {moreOpen && (
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
              {t(moreInfoKey(policySpace, friendForCopy.platform))}
            </p>
          )}
        </div>

        {/* Who's-there — the substance. A real LIST: the group aria-label
            carries the full names while each avatar's accessible name is the
            friend's display name (never a bare repeated status). ≤4 avatars +
            "+N" (hot-card pattern); the CVR total appears only when the
            one-shot fetch resolves. */}
        {instanceForCopy !== null && (present.length > 0 || peopleCount !== null) && (
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
            disabled={isInert}
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
            disabled={isJoining}
            className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-medium text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.cancel')}
          </button>
          {/* Visually primary (the drawer Join recipe) but never auto-focused. */}
          <button
            type="button"
            onClick={() => void confirmPending(resolvedMode)}
            disabled={isInert}
            className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-[filter] disabled:pointer-events-none disabled:opacity-50"
            style={{
              borderColor: 'color-mix(in srgb, var(--op-public) 45%, transparent)',
              background: 'color-mix(in srgb, var(--op-public) 16%, transparent)',
              color: 'var(--op-public-text)'
            }}
          >
            {t('joinConfirm.confirm')}
          </button>
        </div>

        {isDrift ? (
          <button
            type="button"
            onClick={onReview}
            disabled={isJoining}
            className="self-center text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.review')}
          </button>
        ) : (
          /* Never-show-again FOOTNOTE — deliberately not a peer of the buttons. */
          <button
            type="button"
            onClick={() => void joinAndNeverAskAgain()}
            disabled={isInert}
            className="self-center text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.dontAskAgain')}
          </button>
        )}
      </div>
    </div>
  )
}
