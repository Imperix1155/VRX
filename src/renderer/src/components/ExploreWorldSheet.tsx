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
  actionAllowed
}: {
  room: ExploreRoom
  onJoin: (room: ExploreRoom) => void
  actionAllowed: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const enabled = actionAllowed && room.action.state === 'available'
  const access = room.access === 'group-public' ? t('explore.groupPublic') : t('explore.public')
  const details = [room.region, room.groupName].filter((part): part is string => part !== null)
  const disabledLabel = enabled
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
  onJoin
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

  useEffect(() => {
    if (open) openerRef.current = opener
  }, [open, opener])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      closeRef.current?.focus()
    } else if (!open && wasOpenRef.current) {
      const target = openerRef.current?.isConnected ? openerRef.current : focusFallback
      if (target?.isConnected) target.focus()
      openerRef.current = null
    }
    wasOpenRef.current = open
  }, [focusFallback, open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || panelRef.current?.contains(target)) return
      if (target.closest('[data-explore-sheet-opener]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose, open])

  if (shown === null) return <div inert aria-hidden />
  const { world } = shown
  const isVrc = world.platform === 'vrchat'
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
        className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 max-h-[55vh] overflow-y-auto rounded-t-[var(--radius-panel)] border border-[var(--glass-border)] bg-[var(--glass-frost)] p-[var(--space-4)] shadow-[var(--hot-sheet-shadow)] motion-safe:transition-transform ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div
          className="absolute inset-x-0 top-0 h-[4px]"
          style={{
            background: isVrc
              ? 'linear-gradient(90deg, var(--vrc), transparent)'
              : 'linear-gradient(90deg, var(--cvr), transparent)'
          }}
        />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('drawer.close')}
          className="absolute right-[var(--space-3)] top-[var(--space-3)] grid h-[28px] w-[28px] place-items-center rounded-[9px] text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
        >
          ✕
        </button>
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
          {shown.isStale ? (
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
              {t('explore.stale')}
            </p>
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
                  !shown.isStale &&
                  room.platform === world.platform &&
                  room.worldId === world.worldId
                }
              />
            ))}
          </ul>
        ) : null}
        {!shown.roomsComplete && shown.rooms.length > 0 ? (
          <p className="mt-[var(--space-2)] text-xs text-[var(--text-faint)]">
            {t('explore.partialRooms')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
