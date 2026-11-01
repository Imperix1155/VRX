/**
 * AvatarSheet — one avatar's details and the Wear button.
 *
 * The same non-modal bottom sheet as HotInstanceSheet: role="dialog" without
 * aria-modal, no focus trap, initial focus on ✕, and Esc, ✕ or a pointerdown
 * outside (not on another avatar card) closes it. The page restores focus to
 * the opener. VRChat and ChilloutVR show the same fields in the same order;
 * only the platform stripe and label differ.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarItem, AvatarSwitchResult } from '@shared/avatarLibrary'
import { useAvatar } from '../hooks/useAvatar'
import { useSheetExpansion, type SheetExpansion } from '../hooks/useSheetExpansion'
import { useAvatarAccount, useAvatarDetails, useSwitchAvatar } from '../queries/avatarLibrary'
import { PictureBackedPill } from './CardPictureBackdrop'
import PlatformPill from './PlatformPill'
import SheetGrabBar from './SheetGrabBar'

type SwitchFailure = Exclude<AvatarSwitchResult, { ok: true }>['reason']

/** Quoted literals keep the locale parity scan aware of each reason's copy. */
const SWITCH_FAILURE_KEYS: Record<SwitchFailure, string> = {
  cooldown: 'avatars.switchFailed.cooldown',
  'rate-limited': 'avatars.switchFailed.rate-limited',
  'switch-failed': 'avatars.switchFailed.switch-failed',
  'not-authenticated': 'avatars.switchFailed.not-authenticated',
  'unknown-avatar': 'avatars.switchFailed.unknown-avatar'
}

type SwitchStatus =
  { state: 'idle' } | { state: 'done' } | { state: 'failed'; reason: SwitchFailure }

interface AvatarSheetProps {
  avatar: AvatarItem | null
  /** The avatar the platform last reported as worn, for this avatar's platform. */
  wornAvatarId: string | null
  onClose: () => void
}

export default function AvatarSheet({
  avatar,
  wornAvatarId,
  onClose
}: AvatarSheetProps): React.JSX.Element {
  const open = avatar !== null
  // Retain the last avatar so the panel doesn't empty mid slide-out.
  const [retained, setRetained] = useState<AvatarItem | null>(null)
  if (avatar !== null && avatar !== retained) setRetained(avatar)
  const shown = avatar ?? retained

  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // Lives here, above the per-avatar panel, so switching avatars in place
  // keeps the size the user chose.
  const expansion = useSheetExpansion({
    open,
    onClose,
    panelRef,
    collapsed: { minHeight: '360px', maxHeight: '34vh' }
  })

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target)) return
      if (target.closest('[data-avatar-sheet-opener]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose])

  if (shown === null) return <div inert aria-hidden />

  return (
    <div inert={!open} aria-hidden={!open}>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-y-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-40 bg-[var(--scrim-soft)] motion-safe:transition-opacity motion-safe:duration-[220ms] ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <AvatarSheetPanel
        // A new avatar starts with fresh switch feedback.
        key={`${shown.platform}:${shown.avatarId}`}
        avatar={shown}
        open={open}
        worn={wornAvatarId === shown.avatarId}
        panelRef={panelRef}
        closeButtonRef={closeButtonRef}
        expansion={expansion}
        onClose={onClose}
      />
    </div>
  )
}

function AvatarSheetPanel({
  avatar,
  open,
  worn,
  panelRef,
  closeButtonRef,
  expansion,
  onClose
}: {
  avatar: AvatarItem
  open: boolean
  worn: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
  expansion: SheetExpansion
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isVrc = avatar.platform === 'vrchat'
  const platformName = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  const accountId = useAvatarAccount(avatar.platform)
  const details = useAvatarDetails(avatar.platform, avatar.avatarId)
  const shown = details.data?.ok ? details.data.avatar : avatar
  const detailsFailed = details.isError || (details.data !== undefined && !details.data.ok)

  const bannerRef = useRef<HTMLDivElement>(null)
  const bannerDataUrl = useAvatar(shown.imageUrl, bannerRef, 'picture')
  const [failedBanner, setFailedBanner] = useState<string | null>(null)
  const showBannerImage = bannerDataUrl !== null && bannerDataUrl !== failedBanner

  const switcher = useSwitchAvatar()
  const [status, setStatus] = useState<SwitchStatus>({ state: 'idle' })
  const switching = switcher.isPending

  function wear(): void {
    if (accountId === null || switching) return
    setStatus({ state: 'idle' })
    switcher.mutate(
      { avatar, accountId },
      {
        onSuccess: (result) =>
          setStatus(result.ok ? { state: 'done' } : { state: 'failed', reason: result.reason }),
        onError: (error) =>
          setStatus({
            state: 'failed',
            reason: error.message === 'rate_limited' ? 'rate-limited' : 'switch-failed'
          })
      }
    )
  }

  const date = (value: string | null): string =>
    value === null
      ? t('avatars.details.notShown')
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value))
  const facts: Array<[string, string]> = [
    ['avatars.details.creator', shown.authorName ?? t('avatars.details.notShown')],
    [
      'avatars.details.visibility',
      shown.visibility === 'public'
        ? t('avatars.details.public')
        : shown.visibility === 'private'
          ? t('avatars.details.private')
          : t('avatars.details.notShown')
    ],
    ['avatars.details.uploaded', date(shown.createdAt)],
    ['avatars.details.updated', date(shown.updatedAt)]
  ]

  const statusText =
    status.state === 'done'
      ? t('avatars.sheet.switched', { platform: platformName })
      : status.state === 'failed'
        ? t(SWITCH_FAILURE_KEYS[status.reason], { platform: platformName })
        : ''

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('avatars.sheet.aria', { name: shown.name, platform: platformName })}
      data-sheet-expanded={expansion.expanded ? '' : undefined}
      className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 flex flex-col motion-safe:transition-[translate,min-height,max-height] motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${
        open ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{
        backgroundColor: 'var(--glass-information)',
        backgroundImage: 'var(--glass-bg)',
        borderTopLeftRadius: 'var(--radius-panel)',
        borderTopRightRadius: 'var(--radius-panel)',
        borderTop: '1px solid var(--glass-border)',
        boxShadow: 'var(--hot-sheet-shadow)',
        ...expansion.panelStyle
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        aria-label={t('drawer.close')}
        className="absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
      >
        <span aria-hidden="true">✕</span>
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
        <SheetGrabBar expansion={expansion} />

        <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-2)] py-[var(--space-4)]">
          <div
            ref={bannerRef}
            className={`relative w-full shrink-0 overflow-hidden rounded-control motion-safe:transition-[height] motion-safe:duration-[220ms] ${
              expansion.expanded ? 'h-[300px]' : 'h-[150px]'
            }`}
            style={{
              background: showBannerImage
                ? undefined
                : 'linear-gradient(135deg, color-mix(in srgb, var(--text) 10%, transparent), color-mix(in srgb, var(--text) 4%, transparent))'
            }}
          >
            {showBannerImage && (
              <img
                src={bannerDataUrl ?? undefined}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
                style={{
                  filter: 'var(--hot-sheet-banner-image-filter)',
                  // Avatar pictures usually frame a face in the upper third.
                  objectPosition: 'center 30%'
                }}
                onError={() => setFailedBanner(bannerDataUrl)}
              />
            )}
            {showBannerImage && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ backgroundImage: 'var(--hot-sheet-banner-scrim)' }}
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-[var(--space-3)] p-[var(--space-3)]">
              <div className="min-w-0">
                <h2
                  className="truncate text-[21px] font-bold"
                  title={shown.name}
                  style={{
                    color: 'var(--text)',
                    textShadow: 'var(--hot-sheet-banner-title-shadow)'
                  }}
                >
                  {shown.name}
                </h2>
                <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-2)]">
                  <PictureBackedPill backed={showBannerImage}>
                    <PlatformPill platform={avatar.platform} />
                  </PictureBackedPill>
                </div>
              </div>

              <span className="flex max-w-[16rem] shrink-0 flex-col items-end">
                {worn ? (
                  <span
                    className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text)]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'color-mix(in srgb, var(--glass-information) 78%, transparent)'
                    }}
                  >
                    {t('avatars.sheet.wornNow')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={wear}
                    disabled={switching || accountId === null}
                    aria-label={t('avatars.sheet.wearAria', {
                      name: shown.name,
                      platform: platformName
                    })}
                    className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text)] hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-60 motion-safe:transition-[filter]"
                    style={{
                      borderColor: 'var(--control-active-border)',
                      background: showBannerImage
                        ? 'linear-gradient(var(--control-fill-hover), var(--control-fill-hover)) color-mix(in srgb, var(--glass-information) 78%, transparent)'
                        : 'var(--control-fill-hover)'
                    }}
                  >
                    {switching ? t('avatars.sheet.switching') : t('avatars.sheet.wear')}
                  </button>
                )}
                <span
                  role="status"
                  className="text-right text-[12px] leading-snug break-words text-[var(--text-dim)] [&:not(:empty)]:mt-[var(--space-1)]"
                  style={{ textShadow: 'var(--hot-sheet-banner-subtitle-shadow)' }}
                >
                  {statusText}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-[var(--space-4)] sm:flex-row sm:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
                {t('avatars.details.description')}
              </h3>
              {/* A long description stays short until the sheet expands. */}
              <p
                className={`whitespace-pre-line break-words text-[13px] leading-relaxed text-[var(--text)] ${
                  expansion.expanded ? '' : 'line-clamp-4'
                }`}
              >
                {shown.description ?? t('avatars.details.noDescription')}
              </p>
              <p className="mt-[var(--space-3)] text-[12px] text-[var(--text-dim)]">
                {t('avatars.sheet.wearHint', { platform: platformName })}
              </p>
            </div>
            <div className="shrink-0 sm:w-[240px]">
              <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
                {t('avatars.details.heading')}
              </h3>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[13px]">
                {facts.map(([labelKey, value]) => (
                  <div key={labelKey} className="contents">
                    <dt className="text-[var(--text-dim)]">{t(labelKey)}</dt>
                    <dd
                      className={`min-w-0 text-[var(--text)] ${
                        expansion.expanded ? 'break-words' : 'truncate'
                      }`}
                      title={value}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
                {/* Expanded: the ID too, for anyone who shares or looks one up. */}
                {expansion.expanded ? (
                  <div className="contents">
                    <dt className="text-[var(--text-dim)]">{t('avatars.details.avatarId')}</dt>
                    <dd
                      className="min-w-0 select-text break-all text-[12px] text-[var(--text-dim)]"
                      style={{ fontFamily: 'ui-monospace, monospace' }}
                    >
                      {shown.avatarId}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {details.isPending && details.fetchStatus === 'fetching' ? (
                <p className="mt-[var(--space-2)] text-[12px] text-[var(--text-dim)]">
                  {t('avatars.sheet.detailsLoading')}
                </p>
              ) : detailsFailed ? (
                <p className="mt-[var(--space-2)] text-[12px] text-[var(--text-dim)]">
                  {t('avatars.sheet.detailsError')}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
