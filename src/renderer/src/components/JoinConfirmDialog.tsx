/**
 * JoinConfirmDialog (VRX-210 + VRX-239/241) — the ONE join confirmation control
 * surface. Mounted once in AppShell; fed by the shared useJoinInstance store, so
 * every join path (row pill, drawer Join, hot-instance card) funnels here when
 * `settings.confirmJoin` is on.
 *
 * A TRUE modal (aria-modal). Per the owner's ruling it wears the VRX-225
 * drawer's SOFT scrim, not the heavier `--scrim` DESIGN.md names for modals,
 * and a press or tap on it closes the dialog (useScrimDismiss).
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
import type { Friend, JoinHandoff, JoinMode, JoinModePreference, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { useFriends } from '../queries/friends'
import { useInbox } from '../queries/inbox'
import {
  friendForPending,
  resolveWireMode,
  useJoinInstance,
  type FriendPendingConfirm
} from '../hooks/useJoinInstance'
import { useJoinHandoff } from '../hooks/useJoinHandoff'
import { useScrimDismiss } from '../hooks/useScrimDismiss'
import { keepTabInModal } from '../utils/modalTab'
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

/** What Join does when the game is already open, per platform. Quoted-literal
 *  map so the i18n parity scan covers the keys. ChilloutVR has one way only. */
const OPEN_GAME_KEYS: Record<Platform, Partial<Record<JoinHandoff, string>>> = {
  vrchat: {
    'in-game': 'joinConfirm.openGame.vrchatInGame',
    invite: 'joinConfirm.openGame.vrchatInvite'
  },
  chilloutvr: { 'in-game': 'joinConfirm.openGame.chilloutvrInGame' }
}

/** The copy for a Join into an already-open game, or null when Join launches
 *  (or main has not answered yet). */
function openGameKey(platform: Platform, handoff: JoinHandoff | 'pending' | null): string | null {
  return handoff === null || handoff === 'pending'
    ? null
    : (OPEN_GAME_KEYS[platform][handoff] ?? null)
}

/**
 * The launch line (mode picker or launch note) while main checks whether the
 * game is already open: it keeps its place but stays hidden and inert, so the
 * dialog never shows a picker that then turns into the open-game note.
 */
function LaunchLine({
  checking,
  children
}: {
  checking: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={checking ? 'invisible' : undefined}
      inert={checking}
      aria-hidden={checking || undefined}
    >
      {children}
    </div>
  )
}

/**
 * The one modal shell for a Join that is not through a friend: an Explore
 * room, or an invite row. Each is a distinct, typed source; neither is ever
 * dressed up as a Friend. An invite shows who sent it and the world it named:
 * its access and who is there are not known, so no pill or count stands in.
 */
function DirectJoinConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pendingConfirm, isJoining, confirmPending, cancelPending, invalidatePending } =
    useJoinInstance()
  const { onPointerDown: onScrimPointerDown, onClick: onScrimClick } = useScrimDismiss(
    !isJoining,
    cancelPending
  )
  const joinMode = useSettingsStore((state) => state.settings.joinMode)
  const labelScheme = useSettingsStore((state) => state.settings.labelScheme)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [mode, setMode] = useState<JoinMode>('desktop')
  const [moreOpen, setMoreOpen] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)
  const launchInitiatedRef = useRef(false)
  const joiningRef = useRef(isJoining)
  const pending =
    pendingConfirm?.source === 'explore' || pendingConfirm?.source === 'invite'
      ? pendingConfirm
      : null
  const handoff = useJoinHandoff(pending?.platform ?? null, pending?.requestId ?? null)
  // An invite row can leave while its dialog is open (hidden elsewhere, or a
  // newer invite took its place). Main would refuse it; say so before a press.
  const inbox = useInbox()
  useEffect(() => {
    joiningRef.current = isJoining
  }, [isJoining])
  useEffect(() => {
    if (pending === null) return
    openerRef.current = document.activeElement
    launchInitiatedRef.current = false
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !joiningRef.current) cancelPending()
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (panel === null) return
      keepTabInModal(event, panel, getFocusables(panel))
    }
    document.addEventListener('keydown', onKey)
    const boundary = window.vrx?.onIdentityBoundary?.(({ platform }) => invalidatePending(platform))
    const friend = window.vrx?.onFriendEvent?.((event) => {
      if (event.type === 'auth-invalidated') invalidatePending(event.platform)
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      boundary?.()
      friend?.()
      if (launchInitiatedRef.current) {
        focusAfterLaunch(openerRef.current)
      } else {
        const opener = openerRef.current
        const target =
          opener instanceof HTMLElement && opener.isConnected
            ? opener
            : document.querySelector<HTMLElement>('main')
        target?.focus({ preventScroll: true })
      }
    }
  }, [cancelPending, invalidatePending, pending])
  useEffect(() => {
    if (isJoining && pending !== null) launchInitiatedRef.current = true
  }, [isJoining, pending])
  if (pending === null) return null
  const { platform } = pending
  const explore = pending.source === 'explore' ? pending : null
  const invite = pending.source === 'invite' ? pending : null
  // The same access pill as the friend dialog and the world sheet.
  const accessPill = explore
    ? instancePillFor({ type: explore.room.access, opennessUnknown: false }, labelScheme)
    : null
  const inviteGone =
    invite !== null &&
    inbox.data !== undefined &&
    !inbox.data.items.some(
      (item) =>
        item.platform === invite.item.platform &&
        item.id === invite.item.id &&
        item.canJoin === true
    )
  const unavailable = explore ? explore.room.action.state !== 'available' : inviteGone
  const title = explore
    ? explore.world.name
    : (invite?.worldName ?? t('inbox.join.titleNoWorld', { name: invite?.senderName }))
  // The game that is already open ignores VR/desktop, so it gets no picker.
  const openGame = openGameKey(platform, handoff)
  const checkingGame = handoff === 'pending'
  const asksMode = platform === 'chilloutvr' && joinMode === 'ask'
  // A picker hidden while VRX checks offers no choice yet (see LaunchLine).
  const showModePicker = openGame === null && !checkingGame && asksMode
  // Join waits for the check rather than guess a mode while the answer is out.
  const awaitingChoice = checkingGame && asksMode
  const resolvedMode = showModePicker ? mode : resolveWireMode({ platform }, joinMode)
  async function joinAndNeverAskAgain(): Promise<void> {
    const result = await confirmPending(resolvedMode)
    if (result === 'joined') {
      updateSettings({
        confirmJoin: false,
        ...(showModePicker ? { joinMode: mode } : {})
      })
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[var(--space-6)]">
      <div
        data-testid="join-confirm-scrim"
        aria-hidden="true"
        onPointerDown={onScrimPointerDown}
        onClick={onScrimClick}
        className="absolute inset-0 bg-[var(--scrim-soft)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-join-confirm-title"
        tabIndex={-1}
        className="glass glass-frosted-heavy glass-information relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] overflow-hidden p-[var(--space-6)] focus:outline-none"
      >
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <h2
            id="explore-join-confirm-title"
            className="min-w-0 text-base font-semibold text-[var(--text)] break-words"
          >
            {title}
          </h2>
          <div className="flex shrink-0 flex-col items-end gap-[var(--space-1)]">
            <PlatformPill platform={platform} />
            {accessPill !== null ? (
              <InstancePill label={t(accessPill.labelKey)} tier={accessPill.tier} />
            ) : null}
          </div>
        </div>
        {explore !== null ? (
          <>
            <div>
              <PolicySpacePill space="public" />
            </div>
            <p className="text-sm text-[var(--text-dim)]">
              {explore.room.occupancy.state === 'complete'
                ? t('joinConfirm.peopleCount', { count: explore.room.occupancy.value })
                : t('explore.countUnknown')}
            </p>
            <div>
              <button
                type="button"
                aria-expanded={moreOpen}
                disabled={isJoining}
                onClick={() => setMoreOpen((open) => !open)}
                className="text-xs text-[var(--text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                {t('joinConfirm.moreToggle')}
              </button>
              {moreOpen ? (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
                  {t('policySpace.more.public')}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {invite !== null ? (
          <p className="text-sm text-[var(--text-dim)] break-words">
            {t('inbox.join.context', { name: invite.senderName })}
          </p>
        ) : null}
        {/* Stays mounted so a row leaving while the dialog is open is announced. */}
        <div role="status" className="contents">
          {inviteGone ? (
            <p className="text-sm text-[var(--text-dim)]">{t('inbox.join.gone')}</p>
          ) : null}
        </div>
        {openGame !== null ? (
          <p className="text-xs text-[var(--text-dim)]">{t(openGame)}</p>
        ) : (
          <LaunchLine checking={checkingGame}>
            {platform === 'vrchat' ? (
              <p className="text-xs text-[var(--text-dim)]">{t('joinConfirm.vrchatModeNote')}</p>
            ) : joinMode === 'ask' ? (
              <SegmentedControl
                values={MODE_VALUES}
                active={mode}
                labelKeys={MODE_LABEL_KEYS}
                ariaLabel={t('joinConfirm.mode.aria')}
                disabled={isJoining || checkingGame}
                onChange={setMode}
              />
            ) : (
              <p className="text-xs text-[var(--text-dim)]">{t(WILL_LAUNCH_KEYS[joinMode])}</p>
            )}
          </LaunchLine>
        )}
        <div className="mt-[var(--space-1)] flex items-center justify-end gap-[var(--space-2)]">
          <button
            ref={cancelRef}
            type="button"
            disabled={isJoining}
            onClick={cancelPending}
            className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-medium text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.cancel')}
          </button>
          <button
            type="button"
            disabled={isJoining || unavailable || awaitingChoice}
            onClick={() => {
              void confirmPending(resolvedMode)
            }}
            className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-[filter] disabled:pointer-events-none disabled:opacity-50"
            style={{
              borderColor:
                'color-mix(in srgb, var(--op-public) var(--pill-edge-strong), transparent)',
              background:
                'color-mix(in srgb, var(--op-public) var(--pill-tint-strong), transparent)',
              color: 'var(--op-public-text)'
            }}
          >
            {isJoining ? t('explore.joinDenied.busy') : t('joinConfirm.confirm')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void joinAndNeverAskAgain()}
          disabled={isJoining || unavailable || awaitingChoice}
          className="self-center text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {t('joinConfirm.dontAskAgain')}
        </button>
      </div>
    </div>
  )
}

export default function JoinConfirmDialog(): React.JSX.Element | null {
  const { pendingConfirm } = useJoinInstance()
  return pendingConfirm?.source === 'explore' || pendingConfirm?.source === 'invite' ? (
    <DirectJoinConfirmDialog />
  ) : (
    <FriendJoinConfirmDialog />
  )
}

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
      !el.hasAttribute('hidden') &&
      // The unchosen option of a picker is reached with the arrow keys, not Tab.
      el.getAttribute('tabindex') !== '-1'
  )
}

/**
 * Where focus goes after a launch. The control that opened the dialog may be
 * busy or gone, so focus normally returns to the page. When that control sits
 * in a sheet that is still open (a world sheet's or a drawer's Join), focus
 * stays in that sheet instead, next to any failure message, and not on the
 * page behind it.
 */
function focusAfterLaunch(opener: Element | null): void {
  const sheet =
    opener instanceof HTMLElement && opener.isConnected
      ? opener.closest<HTMLElement>('[role="dialog"]')
      : null
  if (sheet !== null && sheet.closest('[inert]') === null) {
    const usable = !(opener instanceof HTMLButtonElement && opener.disabled)
    const target = usable && opener instanceof HTMLElement ? opener : getFocusables(sheet)[0]
    if (target !== undefined) {
      target.focus({ preventScroll: true })
      return
    }
  }
  document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
}

function FriendJoinConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const joinState = useJoinInstance()
  const {
    pendingConfirm: rawPendingConfirm,
    isJoining,
    confirmPending,
    acknowledgePendingTarget,
    cancelPending,
    invalidatePending,
    invalidateFriendPending
  } = joinState
  const pendingConfirm = rawPendingConfirm as FriendPendingConfirm | null
  const { onPointerDown: onScrimPointerDown, onClick: onScrimClick } = useScrimDismiss(
    !isJoining,
    cancelPending
  )
  const joinMode = useSettingsStore((s) => s.settings.joinMode)
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // The dialog renders from the LIVE friend in the TanStack cache. The waiting
  // guard intentionally reads result.dataUpdatedAt (a render-subscribed field)
  // rather than getQueryState().dataUpdateCount, so an identical-data refetch
  // still re-renders the dialog and lifts the guard.
  const liveQuery = useFriends(pendingConfirm?.platform ?? 'vrchat')
  const dataUpdatedAt = liveQuery.dataUpdatedAt ?? 0

  // The same pick as Confirm: for a Join from a hot instance, a friend still
  // in it stands in once the one Join went through has left.
  const liveFriend = pendingConfirm ? friendForPending(liveQuery.data, pendingConfirm) : undefined

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
  // R6: once the live friend is no longer joinable (Ask Me/DND, active, offline),
  // their current instance is hidden information and must not reach the copy.
  const instanceForCopy = isJoinableLive ? liveInstance : null
  const isVrc = friendForCopy?.platform === 'vrchat'

  const [mode, setMode] = useState<JoinMode>('desktop')
  const [moreOpen, setMoreOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)
  const lastRequestId = useRef<number | null>(null)
  const launchInitiatedRef = useRef(false)
  const wasOpenRef = useRef(false)

  const isOpen = pendingConfirm !== null
  const handoff = useJoinHandoff(
    pendingConfirm?.platform ?? null,
    pendingConfirm?.requestId ?? null
  )

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
    restoreFocusRef.current = document.activeElement
    cancelRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirm?.requestId])

  // Track whether THIS dialog session committed a launch; if so, restore focus
  // to the main landmark rather than the opener (the row pill re-enables once
  // the join completes and is no longer the right focus target).
  useEffect(() => {
    if (isJoining && pendingConfirm !== null) launchInitiatedRef.current = true
  }, [isJoining, pendingConfirm])

  // Scope all join state to its live platform session. Direct joins need the
  // same boundary/unmount cleanup as parked confirmations.
  // The shared store scopes invalidation to pending, direct, or failed joins
  // on the affected platform. Its callbacks stay stable across renders.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) return
    const unsubscribeIdentity = window.vrx.onIdentityBoundary?.(({ platform }) => {
      invalidatePending(platform)
    })
    const unsubscribeFriend = window.vrx.onFriendEvent?.((event) => {
      if (event.type === 'auth-invalidated') {
        invalidatePending(event.platform)
      }
    })
    return () => {
      unsubscribeIdentity?.()
      unsubscribeFriend?.()
      // Use invalidatePending on unmount: a launch may still be settling and
      // cancelPending would leave the latch alive.
      invalidateFriendPending()
    }
  }, [invalidatePending, invalidateFriendPending])

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
      // A committed launch should hand focus back to the page (or the sheet
      // the opener sits in), not to the row pill the user already acted on.
      if (launchInitiatedRef.current) {
        focusAfterLaunch(restoreFocusRef.current)
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
      // Focus OUTSIDE the panel, on a disabled/hidden element, or on the panel
      // itself while every control is inert goes back to a valid anchor.
      keepTabInModal(event, panel, getFocusables(panel))
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
  // guessed type. Policy Unknown can also mean an impossible platform/type
  // pairing, so policy space does not drive the access-type title.
  const title =
    typeLabel !== null && instanceForCopy?.opennessUnknown !== true
      ? t('joinConfirm.title', { type: typeLabel })
      : t('joinConfirm.titleUnknown')
  const worldName = instanceForCopy?.worldName ?? t('friends.instance.unknownWorld')

  // Mode: the CVR picker only appears for joinMode 'ask' (research-settled —
  // CVR's deep link genuinely honors startInVR). VRChat can never select a
  // mode over its launch URI, so it gets the honest one-line note instead of
  // a fake control.
  // A game that is already open ignores VR/desktop, so it gets a note instead.
  // While VRX checks, the launch line keeps its place hidden (LaunchLine), and
  // that hidden picker offers no choice yet.
  const openGame = openGameKey(friendForCopy.platform, handoff)
  const checkingGame = handoff === 'pending'
  const asksMode = friendForCopy.platform === 'chilloutvr' && joinMode === 'ask'
  const showModePicker = openGame === null && !checkingGame && asksMode
  // Join waits for the check rather than guess a mode while the answer is out.
  const awaitingChoice = checkingGame && asksMode
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
  // Alphabetical, like the hot card and sheet, so the faces come in the same
  // order everywhere this instance shows them.
  present.sort((a, b) => a.displayName.localeCompare(b.displayName))
  const shown = present.slice(0, WHO_THERE_MAX_AVATARS)
  const overflow = present.length - shown.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: present.length,
    names: present.map((f) => f.displayName).join(t('listSeparator'))
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
      {/* Soft scrim (owner-ruled, the VRX-225 pattern) — pure depth; a press
          or tap on it closes only this dialog (useScrimDismiss), but not while
          the launch is in flight (the modal is inert then). */}
      <div
        data-testid="join-confirm-scrim"
        aria-hidden="true"
        onPointerDown={onScrimPointerDown}
        onClick={onScrimClick}
        className="absolute inset-0 bg-[var(--scrim-soft)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-confirm-title"
        tabIndex={-1}
        className="glass glass-frosted-heavy glass-information relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] overflow-hidden p-[var(--space-6)] focus:outline-none"
      >
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <h2
            id="join-confirm-title"
            className="min-w-0 text-base font-semibold text-[var(--text)] break-words"
          >
            {title}
          </h2>
          <div className="flex shrink-0 flex-col items-end gap-[var(--space-1)]">
            <PlatformPill platform={friendForCopy.platform} />
            {pill !== null && <InstancePill label={t(pill.labelKey)} tier={pill.tier} />}
          </div>
        </div>

        {/* World/friend context followed by the independent moderation context. */}
        <p className="text-sm text-[var(--text-dim)] break-words">
          {t('joinConfirm.context', { name: friendForCopy.displayName, world: worldName })}
        </p>
        {instanceForCopy !== null && (
          <div>
            <PolicySpacePill space={policySpace} />
          </div>
        )}

        {/* Drift / unavailable / waiting notices — quiet-styled per VRX-245.
            One status region that stays mounted, so a notice appearing while
            the dialog is open is announced. `contents` keeps the column gap. */}
        <div role="status" className="contents">
          {isDrift && (
            <p className="text-sm text-[var(--text-dim)]">
              {t('joinConfirm.driftNotice', { name: friendForCopy.displayName })}
            </p>
          )}
          {isWaiting && (
            <p className="text-sm text-[var(--text-dim)]">{t('joinConfirm.waiting')}</p>
          )}
          {isUnavailable && (
            <p className="text-sm text-[var(--text-dim)]">
              {t('joinConfirm.unavailable', { name: pendingConfirm.displayName })}
            </p>
          )}
        </div>

        {/* Quiet progressive disclosure — an inline expander, not a modal. */}
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            disabled={isJoining}
            onClick={() => setMoreOpen((open) => !open)}
            className="text-xs text-[var(--text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
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
            "+N" (hot-card pattern). */}
        {instanceForCopy !== null && present.length > 0 && (
          <div
            role="list"
            aria-label={whoHereAria}
            className="flex items-center gap-[var(--space-2)]"
          >
            {shown.map((f) => (
              <span role="listitem" key={`${f.platform}:${f.platformUserId}`} title={f.displayName}>
                <Avatar friend={f} ariaLabel={f.displayName} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="shrink-0 text-[13.5px] font-bold text-[var(--text)]">
                {t('dashboard.friendsOverflow', { count: overflow })}
              </span>
            )}
          </div>
        )}

        {openGame !== null ? (
          <p className="text-xs text-[var(--text-dim)]">{t(openGame)}</p>
        ) : (
          <LaunchLine checking={checkingGame}>
            {isVrc ? (
              <p className="text-xs text-[var(--text-dim)]">{t('joinConfirm.vrchatModeNote')}</p>
            ) : joinMode === 'ask' ? (
              <SegmentedControl
                values={MODE_VALUES}
                active={mode}
                labelKeys={MODE_LABEL_KEYS}
                ariaLabel={t('joinConfirm.mode.aria')}
                disabled={isInert || checkingGame}
                onChange={setMode}
              />
            ) : (
              // CVR with an explicit preference: no picker, but the dialog
              // still says what confirming will do.
              <p className="text-xs text-[var(--text-dim)]">{t(WILL_LAUNCH_KEYS[joinMode])}</p>
            )}
          </LaunchLine>
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
            disabled={isInert || awaitingChoice}
            className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-[filter] disabled:pointer-events-none disabled:opacity-50"
            style={{
              borderColor:
                'color-mix(in srgb, var(--op-public) var(--pill-edge-strong), transparent)',
              background:
                'color-mix(in srgb, var(--op-public) var(--pill-tint-strong), transparent)',
              color: 'var(--op-public-text)'
            }}
          >
            {isJoining ? t('explore.joinDenied.busy') : t('joinConfirm.confirm')}
          </button>
        </div>

        {isDrift ? (
          <button
            type="button"
            onClick={onReview}
            disabled={isJoining}
            className="self-center text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.review')}
          </button>
        ) : (
          /* Never-show-again FOOTNOTE — deliberately not a peer of the buttons. */
          <button
            type="button"
            onClick={() => void joinAndNeverAskAgain()}
            disabled={isInert || awaitingChoice}
            className="self-center text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('joinConfirm.dontAskAgain')}
          </button>
        )}
      </div>
    </div>
  )
}
