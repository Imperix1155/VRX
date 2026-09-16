import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExploreCount,
  ExploreJoinDenial,
  ExploreRoom,
  ExploreWorldSnapshot
} from '@shared/explore'
import PlatformPill from './PlatformPill'

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
  joinFailureFor?: (room: ExploreRoom) => boolean
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
  const { t } = useTranslation()
  return <>{count.state === 'complete' ? count.value : t('explore.unknownCount')}</>
}

function RoomRow({
  room,
  onJoin,
  actionAllowed,
  joining
}: {
  room: ExploreRoom
  onJoin: (room: ExploreRoom) => void
  actionAllowed: boolean
  joining: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const enabled = actionAllowed && room.action.state === 'available'
  const access = room.access === 'group-public' ? t('explore.groupPublic') : t('explore.public')
  const details = [room.region, room.groupName].filter((part): part is string => part !== null)
  const disabledLabel = joining
    ? t('explore.joinDenied.busy')
    : enabled
      ? null
      : room.action.state === 'disabled'
        ? t(denialKey[room.action.reason])
        : t('explore.joinDenied.unavailable')
  return (
    <li className="flex min-w-0 items-center justify-between gap-[var(--space-3)] rounded-[13px] border border-[var(--border)] bg-[var(--control-fill)] p-[var(--space-3)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="rounded-[9px] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-0-5)] text-xs font-semibold text-[var(--text)]">
            {access}
          </span>
          <span className="text-xs text-[var(--text-dim)]">
            <Count count={room.occupancy} />
            {room.capacity === null ? '' : ` / ${room.capacity}`}
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
  const { t } = useTranslation()
  const [retained, setRetained] = useState<ExploreWorldSnapshot | null>(null)
  if (snapshot !== null && snapshot !== retained) setRetained(snapshot)
  const shown = snapshot ?? retained
  const open = snapshot !== null
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
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
        className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 flex max-h-[55vh] flex-col rounded-t-[var(--radius-panel)] border border-[var(--glass-border)] shadow-[var(--hot-sheet-shadow)] motion-safe:transition-transform ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          backgroundColor: 'var(--glass-frost)',
          backgroundImage: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur-frosted)',
          WebkitBackdropFilter: 'var(--glass-blur-frosted)'
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
          <div className="min-h-0 overflow-y-auto p-[var(--space-4)]">
            {image && failedImage !== image ? (
              <img
                src={image}
                alt=""
                className="h-[120px] w-full rounded-[13px] object-cover"
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
              {isStale ? (
                <div className="mt-[var(--space-1)] flex items-center gap-[var(--space-2)]">
                  <p className="text-xs text-[var(--text-dim)]">{t('explore.stale')}</p>
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
              <p className="mt-[var(--space-2)] text-sm text-[var(--text-faint)]">
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
                    joining={joining}
                  />
                ))}
              </ul>
            ) : null}
            {shown.rooms.some((room) => joinFailureFor?.(room)) ? (
              <p role="status" className="mt-[var(--space-2)] text-xs text-[var(--error)]">
                {t('explore.joinFailed')}
              </p>
            ) : null}
            {!shown.roomsComplete && shown.rooms.length > 0 ? (
              <p className="mt-[var(--space-2)] text-xs text-[var(--text-faint)]">
                {t('explore.partialRooms')}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
