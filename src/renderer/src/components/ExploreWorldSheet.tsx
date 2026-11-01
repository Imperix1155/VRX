import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExploreCount,
  ExploreJoinDenial,
  ExploreRoom,
  ExploreWorldSnapshot
} from '@shared/explore'
import PlatformPill from './PlatformPill'
import SheetGrabBar from './SheetGrabBar'
import { SheetFacts, type SheetFact } from './SheetFacts'
import { useSheetExpansion } from '../hooks/useSheetExpansion'
import { joinFailureMessageKey, type JoinFeedback } from '../hooks/useJoinInstance'
import { formatCount, regionLabelKey } from '../utils/exploreFormat'

/** Failures where "refresh and try again" is wrong advice; they keep their own copy.
 *  Explore's `stale` means an expired selection, so refreshing is the right advice.
 *  `launch-failed` means the game link didn't open, so the advice is to check the game.
 *  `invite-failed` means VRChat was open and its self-invite didn't go through. */
const RETRYABLE_EXPLORE_FAILURES: ReadonlySet<JoinFeedback> = new Set([
  'cooldown',
  'rate-limited',
  'joining-disabled',
  'launch-failed',
  'invite-failed'
])

/** Hand-off notes after a Join that reached a game which was already open. */
const JOIN_NOTICES: ReadonlySet<JoinFeedback> = new Set(['in-game', 'invite-sent'])

export interface ExploreWorldSheetProps {
  snapshot: ExploreWorldSnapshot | null
  image?: string
  /** The card opener supplied by the parent; updated when switching worlds in-place. */
  opener: HTMLElement | null
  /** Connected fallback, normally the main landmark, when an opener disappeared. */
  focusFallback: HTMLElement | null
  onClose: () => void
  onJoin: (room: ExploreRoom) => void
  /** A true Join modal owns Escape/outside while the contained sheet remains visible beneath it. */
  dismissable?: boolean
  joining?: boolean
  onRefresh?: () => void
  joinFailureFor?: (room: ExploreRoom) => JoinFeedback | null
  /** A coordinated sibling-sheet handoff consumes this once to preserve the
   * incoming sheet's initial focus. Ordinary sheet closure still restores focus. */
  consumeFocusRestoreSuppression?: () => boolean
}

const denialKey: Readonly<Record<ExploreJoinDenial, string>> = {
  full: 'explore.joinDenied.full',
  restricted: 'explore.joinDenied.restricted',
  unavailable: 'explore.joinDenied.unavailable',
  unknown: 'explore.joinDenied.unknown',
  stale: 'explore.joinDenied.stale',
  busy: 'explore.joinDenied.busy',
  'joining-disabled': 'explore.joinDenied.joining-disabled'
}

function Count({ count }: { count: ExploreCount }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <>
      {count.state === 'complete'
        ? formatCount(count.value, i18n.language)
        : t('explore.unknownCount')}
    </>
  )
}

function RoomRow({
  room,
  onJoin,
  actionAllowed,
  stale,
  joining
}: {
  room: ExploreRoom
  onJoin: (room: ExploreRoom) => void
  actionAllowed: boolean
  /** Saved results: an otherwise joinable room asks for a refresh first. */
  stale: boolean
  joining: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const detailsId = useId()
  const enabled = actionAllowed && room.action.state === 'available'
  const access = room.access === 'group-public' ? t('explore.groupPublic') : t('explore.public')
  const region = regionLabelKey(room.platform, room.region)
  const details = [region === null ? null : t(region), room.groupName].filter(
    (part): part is string => part !== null
  )
  const disabledLabel = joining
    ? t('explore.joinDenied.busy')
    : enabled
      ? null
      : room.action.state === 'disabled'
        ? t(denialKey[room.action.reason])
        : stale
          ? t('explore.joinDenied.stale')
          : t('explore.joinDenied.unavailable')
  return (
    <li className="flex min-w-0 items-center justify-between gap-[var(--space-3)] rounded-[13px] border border-[var(--border)] bg-[var(--control-fill)] p-[var(--space-3)]">
      <div id={detailsId} className="min-w-0">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="rounded-[9px] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-0-5)] text-xs font-semibold text-[var(--text)]">
            {access}
          </span>
          <span className="text-xs text-[var(--text-dim)]">
            <Count count={room.occupancy} />
            {room.capacity === null ? '' : ` / ${formatCount(room.capacity, i18n.language)}`}
          </span>
        </div>
        {details.length > 0 ? (
          <p className="mt-[var(--space-1)] truncate text-xs text-[var(--text-dim)]">
            {details.join(' · ')}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        <button
          type="button"
          disabled={!enabled}
          title={disabledLabel ?? undefined}
          aria-describedby={detailsId}
          onClick={() => {
            if (enabled) onJoin(room)
          }}
          className="rounded-[10px] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:text-[var(--text-faint)]"
        >
          {enabled ? t('drawer.join') : disabledLabel}
        </button>
      </div>
    </li>
  )
}

/** Non-modal, contained bottom sheet. Parent controls selection and room freshness. */
export default function ExploreWorldSheet({
  snapshot,
  image,
  opener,
  focusFallback,
  onClose,
  onJoin,
  dismissable = true,
  joining = false,
  onRefresh,
  joinFailureFor,
  consumeFocusRestoreSuppression
}: ExploreWorldSheetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [retained, setRetained] = useState<ExploreWorldSnapshot | null>(null)
  if (snapshot !== null && snapshot !== retained) setRetained(snapshot)
  const shown = snapshot ?? retained
  const joinFailure =
    shown?.rooms.map((room) => joinFailureFor?.(room) ?? null).find((reason) => reason !== null) ??
    null
  const open = snapshot !== null
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const expansion = useSheetExpansion({
    open,
    onClose,
    panelRef,
    collapsed: { minHeight: '0px', maxHeight: '55vh' }
  })
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const [expiredFreshnessKey, setExpiredFreshnessKey] = useState<string | null>(null)
  const freshnessKey =
    snapshot?.updatedAt === null || snapshot?.updatedAt === undefined
      ? null
      : `${snapshot.world.platform}:${snapshot.world.worldRef}:${snapshot.updatedAt}`

  useEffect(() => {
    if (snapshot === null || snapshot.isStale || freshnessKey === null) return
    const updatedAt = snapshot.updatedAt
    if (updatedAt === null) return
    const delay = Math.max(0, updatedAt + 60_000 - Date.now())
    const timer = window.setTimeout(() => setExpiredFreshnessKey(freshnessKey), delay)
    return () => window.clearTimeout(timer)
  }, [freshnessKey, snapshot])

  useEffect(() => {
    if (open) openerRef.current = opener
  }, [open, opener])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      closeRef.current?.focus()
    } else if (!open && wasOpenRef.current) {
      if (!consumeFocusRestoreSuppression?.()) {
        const target = openerRef.current?.isConnected
          ? openerRef.current
          : (focusFallback ?? document.querySelector<HTMLElement>('main'))
        if (target?.isConnected) target.focus()
      }
      openerRef.current = null
    }
    wasOpenRef.current = open
  }, [consumeFocusRestoreSuppression, focusFallback, open])
  useEffect(() => {
    if (!open || !dismissable) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, dismissable])
  useEffect(() => {
    if (!open || !dismissable) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || panelRef.current?.contains(target)) return
      if (target.closest('[data-explore-sheet-opener]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose, open, dismissable])

  if (shown === null) return <div inert aria-hidden />
  const { world } = shown
  const isVrc = world.platform === 'vrchat'
  const isStale = shown.isStale || (freshnessKey !== null && expiredFreshnessKey === freshnessKey)
  // "Saved results" only describes rooms that are on screen; an error or an
  // empty list keeps its own line, and Refresh stays available beside it.
  const showStaleNote =
    isStale && shown.rooms.length > 0 && shown.status !== 'error' && shown.status !== 'unavailable'
  const notShown = t('sheet.notShown')
  const regions = [
    ...new Set(
      shown.rooms
        .map((room) => regionLabelKey(room.platform, room.region))
        .filter((key): key is string => key !== null)
        .map((key) => t(key))
    )
  ]
  const moreFacts: SheetFact[] = [
    {
      label: t('explore.more.people'),
      value:
        world.activity.state === 'complete'
          ? formatCount(world.activity.value, i18n.language)
          : t('explore.unknownCount')
    },
    { label: t('explore.more.regions'), value: regions.length > 0 ? regions.join(', ') : notShown },
    {
      label: t('explore.more.checked'),
      value:
        shown.updatedAt === null
          ? notShown
          : new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(
              new Date(shown.updatedAt)
            )
    }
  ]
  return (
    <div inert={!open} aria-hidden={!open}>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-y-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-40 bg-[var(--scrim-soft)] ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('explore.sheetAria', {
          world: world.name,
          platform: t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
        })}
        data-sheet-expanded={expansion.expanded ? '' : undefined}
        className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 flex flex-col rounded-t-[var(--radius-panel)] border border-[var(--glass-border)] shadow-[var(--hot-sheet-shadow)] motion-safe:transition-[translate,min-height,max-height] motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          // Opaque backing: a backdrop blur would never show (main.css .glass-information).
          backgroundColor: 'var(--glass-information)',
          backgroundImage: 'var(--glass-bg)',
          ...expansion.panelStyle
        }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('drawer.close')}
          className="absolute right-[var(--space-3)] top-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
        >
          ✕
        </button>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[var(--radius-panel)]">
          <div
            aria-hidden="true"
            className="h-[4px] w-full shrink-0"
            style={{
              background: isVrc
                ? 'linear-gradient(90deg, var(--vrc), transparent)'
                : 'linear-gradient(90deg, var(--cvr), transparent)'
            }}
          />
          {/* Same grab bar as the Hot Instance sheet: it gives the close button
              its own row, so the world picture never sits under it. */}
          <SheetGrabBar expansion={expansion} />
          <div className="min-h-0 flex-1 overflow-y-auto p-[var(--space-4)]">
            {image && failedImage !== image ? (
              <img
                src={image}
                alt=""
                className={`w-full rounded-[13px] object-cover motion-safe:transition-[height] motion-safe:duration-[220ms] ${
                  expansion.expanded ? 'h-[220px]' : 'h-[120px]'
                }`}
                onError={() => setFailedImage(image)}
              />
            ) : null}
            <div className="mt-[var(--space-3)] pr-[var(--space-8)]">
              <h2 className="truncate text-xl font-bold text-[var(--text)]" title={world.name}>
                {world.name}
              </h2>
              <div className="mt-[var(--space-1)]">
                <PlatformPill platform={world.platform} />
              </div>
              {showStaleNote || (isStale && onRefresh) ? (
                <div className="mt-[var(--space-1)] flex items-center gap-[var(--space-2)]">
                  {showStaleNote ? (
                    <p className="text-xs text-[var(--text-dim)]">{t('explore.stale')}</p>
                  ) : null}
                  {onRefresh ? (
                    <button
                      type="button"
                      onClick={onRefresh}
                      className="text-xs text-[var(--text)] underline"
                    >
                      {t('explore.refresh')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {expansion.expanded ? (
              <div className="mt-[var(--space-4)]">
                <SheetFacts heading={t('explore.more.heading')} facts={moreFacts} />
              </div>
            ) : null}
            <h3 className="mt-[var(--space-4)] text-sm font-semibold text-[var(--text)]">
              {t('explore.visiblePublicRooms')}
            </h3>
            {shown.status === 'loading' ? (
              <p className="mt-[var(--space-2)] text-sm text-[var(--text-dim)]">
                {t('explore.loadingRooms')}
              </p>
            ) : null}
            {shown.status === 'error' ? (
              <p className="mt-[var(--space-2)] text-sm text-[var(--error)]">
                {t('explore.roomsError')}
              </p>
            ) : null}
            {shown.status === 'unavailable' ? (
              <p className="mt-[var(--space-2)] text-sm text-[var(--error)]">
                {t('explore.roomsUnavailable')}
              </p>
            ) : null}
            {shown.rooms.length === 0 && shown.status === 'ready' && shown.roomsComplete ? (
              <p className="mt-[var(--space-2)] text-sm text-[var(--text-dim)]">
                {t('explore.noVisibleRooms')}
              </p>
            ) : null}
            {shown.rooms.length === 0 && shown.status === 'ready' && !shown.roomsComplete ? (
              <p className="mt-[var(--space-2)] text-sm text-[var(--text-dim)]">
                {t('explore.incompleteRooms')}
              </p>
            ) : null}
            {shown.rooms.length > 0 ? (
              <ul className="mt-[var(--space-2)] grid gap-[var(--space-2)]">
                {shown.rooms.map((room) => (
                  <RoomRow
                    key={room.roomId}
                    room={room}
                    onJoin={onJoin}
                    actionAllowed={
                      shown.status === 'ready' &&
                      !isStale &&
                      !joining &&
                      room.platform === world.platform &&
                      room.worldId === world.worldId
                    }
                    stale={isStale}
                    joining={joining}
                  />
                ))}
              </ul>
            ) : null}
            {joinFailure != null && JOIN_NOTICES.has(joinFailure) ? (
              <p role="status" className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">
                {t(joinFailureMessageKey(joinFailure))}
              </p>
            ) : joinFailure != null ? (
              <p role="status" className="mt-[var(--space-2)] text-xs text-[var(--error)]">
                {t(
                  RETRYABLE_EXPLORE_FAILURES.has(joinFailure)
                    ? joinFailureMessageKey(joinFailure)
                    : 'explore.joinFailed'
                )}
              </p>
            ) : null}
            {!shown.roomsComplete && shown.rooms.length > 0 ? (
              <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">
                {t('explore.partialRooms')}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
