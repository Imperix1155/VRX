/**
 * CommunitySheet — the bottom sheet a person (Search) or a group (Groups)
 * opens in. The same non-modal sheet as AvatarSheet and HotInstanceSheet:
 * role="dialog" without aria-modal, no focus trap, initial focus on ✕, and
 * Esc, ✕ or a pointerdown outside (not on another tile) closes it. The page
 * restores focus to the opener. VRChat and ChilloutVR share this exact frame;
 * only the platform stripe and label differ.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useAvatar } from '../hooks/useAvatar'
import { PictureBackedPill } from './CardPictureBackdrop'
import PlatformPill from './PlatformPill'
import { PILL_BASE } from '../utils/instancePill'

export interface CommunitySheetHeader {
  platform: Platform
  title: string
  /** The banner picture: a group banner, or the person's picture. */
  imageUrl: string | null
  ariaLabel: string
  /** Quiet pills beside the platform label ("Friend", "Owner"). */
  tags?: string[]
}

interface CommunitySheetProps<T> {
  item: T | null
  itemKey: (item: T) => string
  header: (item: T) => CommunitySheetHeader
  onClose: () => void
  children: (item: T) => React.ReactNode
}

export default function CommunitySheet<T>({
  item,
  itemKey,
  header,
  onClose,
  children
}: CommunitySheetProps<T>): React.JSX.Element {
  const open = item !== null
  // Retain the last item so the panel doesn't empty mid slide-out.
  const [retained, setRetained] = useState<T | null>(null)
  if (item !== null && item !== retained) setRetained(item)
  const shown = item ?? retained

  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target)) return
      if (target.closest('[data-community-sheet-opener]')) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose])

  if (shown === null) return <div inert aria-hidden />
  const head = header(shown)

  return (
    <div inert={!open} aria-hidden={!open}>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-y-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-40 bg-[var(--scrim-soft)] motion-safe:transition-opacity motion-safe:duration-[220ms] ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={head.ariaLabel}
        data-community-sheet=""
        className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 flex max-h-[72vh] min-h-[360px] flex-col motion-safe:transition-transform motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          backgroundColor: 'var(--glass-information)',
          backgroundImage: 'var(--glass-bg)',
          borderTopLeftRadius: 'var(--radius-panel)',
          borderTopRightRadius: 'var(--radius-panel)',
          borderTop: '1px solid var(--glass-border)',
          boxShadow: 'var(--hot-sheet-shadow)'
        }}
      >
        <SheetCloseButton buttonRef={closeButtonRef} onClose={onClose} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[var(--radius-panel)]">
          <div
            aria-hidden="true"
            className="h-[4px] w-full shrink-0"
            style={{
              background:
                head.platform === 'vrchat'
                  ? 'linear-gradient(90deg, var(--vrc), transparent)'
                  : 'linear-gradient(90deg, var(--cvr), transparent)'
            }}
          />
          <div className="flex justify-center pt-[var(--space-3)] pb-[var(--space-2)]">
            <div
              aria-hidden="true"
              className="h-[4px] w-[44px] rounded-full"
              style={{ background: 'var(--border)' }}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-2)] py-[var(--space-4)]">
            {/* A new item starts with a fresh banner and fresh disclosures. */}
            <SheetBanner key={itemKey(shown)} header={head} />
            <div key={`body:${itemKey(shown)}`}>{children(shown)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SheetCloseButton({
  buttonRef,
  onClose
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClose}
      aria-label={t('drawer.close')}
      className="absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
    >
      <span aria-hidden="true">✕</span>
    </button>
  )
}

function SheetBanner({ header }: { header: CommunitySheetHeader }): React.JSX.Element {
  const bannerRef = useRef<HTMLDivElement>(null)
  const bannerDataUrl = useAvatar(header.imageUrl, bannerRef)
  const [failedBanner, setFailedBanner] = useState<string | null>(null)
  const showImage = bannerDataUrl !== null && bannerDataUrl !== failedBanner
  return (
    <div
      ref={bannerRef}
      className="relative h-[132px] w-full shrink-0 overflow-hidden rounded-control"
      style={{
        background: showImage
          ? undefined
          : 'linear-gradient(135deg, color-mix(in srgb, var(--text) 10%, transparent), color-mix(in srgb, var(--text) 4%, transparent))'
      }}
    >
      {showImage && (
        <img
          src={bannerDataUrl ?? undefined}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          style={{ filter: 'var(--hot-sheet-banner-image-filter)', objectPosition: 'center 30%' }}
          onError={() => setFailedBanner(bannerDataUrl)}
        />
      )}
      {showImage && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'var(--hot-sheet-banner-scrim)' }}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 min-w-0 p-[var(--space-3)]">
        <h2
          className="truncate text-[21px] font-bold"
          title={header.title}
          style={{ color: 'var(--text)', textShadow: 'var(--hot-sheet-banner-title-shadow)' }}
        >
          {header.title}
        </h2>
        <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-2)]">
          <PictureBackedPill backed={showImage}>
            <PlatformPill platform={header.platform} />
          </PictureBackedPill>
          {(header.tags ?? []).map((tag) => (
            <PictureBackedPill key={tag} backed={showImage}>
              <span
                data-community-tag=""
                className={`${PILL_BASE} text-[var(--text)]`}
                style={{ borderColor: 'var(--border)', background: 'var(--control-fill)' }}
              >
                {tag}
              </span>
            </PictureBackedPill>
          ))}
        </div>
      </div>
    </div>
  )
}
