/**
 * Shared pieces of the Search, Groups and Explore list pages and the profile
 * views: the one-line per-platform notice, the picture tile, and the section
 * heading. VRChat and ChilloutVR use the exact same pieces; only the platform
 * tint and label differ.
 */
import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useAvatar, useAvatarImage } from '../hooks/useAvatar'
import GoToAccountsButton from './GoToAccountsButton'
import { platformName, type CommunityNoticeReason, type CommunitySource } from '../utils/community'
import { initialOf } from '../utils/initialOf'

/** Quoted literals keep the locale parity scan aware of these key families. */
const NOT_CONNECTED_KEYS: Record<Platform, string> = {
  vrchat: 'community.notConnected.vrchat',
  chilloutvr: 'community.notConnected.chilloutvr'
}
const ERROR_KEYS: Record<CommunityNoticeReason, string> = {
  unavailable: 'community.error.unavailable',
  'rate-limited': 'community.error.rate-limited',
  'not-authenticated': 'community.error.not-authenticated',
  cooldown: 'community.error.cooldown',
  'invalid-query': 'community.error.invalid-query'
}

/**
 * One platform's not-connected, loading, failed or stale line. Ready and idle
 * show nothing. Failed is red (nothing loaded); stale is dim, because the
 * answer that loaded last still shows (DESIGN.md §9.4).
 */
export function CommunityNotice({
  platform,
  state,
  onRetry
}: {
  platform: Platform
  state: CommunitySource<unknown>
  onRetry?: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const noticeRef = useRef<HTMLDivElement>(null)
  if (state.kind === 'ready' || state.kind === 'idle' || state.kind === 'auth-pending') return null
  const name = platformName(t, platform)

  let text: string
  let action: React.JSX.Element | null = null
  let tone = 'text-[var(--text-dim)]'
  const accountsButton = <GoToAccountsButton label={t('community.openAccounts')} />
  if (state.kind === 'not-connected') {
    text = t(NOT_CONNECTED_KEYS[platform])
    action = accountsButton
  } else if (state.kind === 'failed') {
    text = t(ERROR_KEYS[state.reason], { platform: name })
    tone = 'text-[var(--error)]'
    // "Sign in again" is done in Accounts; another try would only fail the same way.
    action =
      state.reason === 'not-authenticated' ? (
        accountsButton
      ) : onRetry && state.reason !== 'invalid-query' ? (
        <button
          type="button"
          onClick={() => {
            onRetry()
            // The line turns into the loading line and this button leaves it;
            // focus stays on the line, beside a Try again that comes back.
            noticeRef.current?.focus({ preventScroll: true })
          }}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('community.retry')}
        </button>
      ) : null
  } else if (state.kind === 'stale') {
    // The page's own Refresh is the way to try again.
    text = t(state.rateLimited ? 'community.staleRateLimited' : 'community.stale', {
      platform: name
    })
  } else {
    text = t('community.loading', { platform: name })
  }

  return (
    // Keyboard focus can rest on the line, so the line itself has no role that
    // changes under it; its words are what screen readers hear change.
    <div
      ref={noticeRef}
      data-community-notice={platform}
      tabIndex={-1}
      className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)] outline-none"
    >
      {/* The notice text names the platform, so the dot is never the only cue. */}
      <span
        aria-hidden="true"
        className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
        style={{ background: platform === 'vrchat' ? 'var(--vrc)' : 'var(--cvr)' }}
      />
      <p role={state.kind === 'failed' ? 'alert' : 'status'} className={`text-sm ${tone}`}>
        {text}
      </p>
      {action}
    </div>
  )
}

/** The notices of every platform that has one, stacked; nothing when none does. */
export function CommunityNotices({
  sources,
  onRetry
}: {
  sources: ReadonlyArray<{ platform: Platform; state: CommunitySource<unknown> }>
  onRetry?: (platform: Platform) => void
}): React.JSX.Element | null {
  const shown = sources.filter(
    ({ state }) => !['ready', 'idle', 'auth-pending'].includes(state.kind)
  )
  if (shown.length === 0) return null
  return (
    <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
      {shown.map(({ platform, state }) => (
        <CommunityNotice
          key={platform}
          platform={platform}
          state={state}
          onRetry={onRetry ? () => onRetry(platform) : undefined}
        />
      ))}
    </div>
  )
}

export function CommunityHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="canvas-text mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
      {children}
    </h2>
  )
}

/** The short platform badge drawn over a picture (VRC / CVR). */
export function PictureBadge({
  platform,
  inline = false
}: {
  platform: Platform
  /** In the text beside a small picture instead of over a large one. */
  inline?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = platform === 'vrchat'
  return (
    <span
      aria-hidden="true"
      className={`${
        inline ? 'inline-block shrink-0' : 'absolute left-[var(--space-2)] top-[var(--space-2)]'
      } glass-chip rounded-[9px] border px-[var(--space-2)] py-[var(--space-0-5)] text-[10px] font-bold`}
      style={{
        color: isVrc ? 'var(--plat-vrc-badge-text)' : 'var(--plat-cvr-badge-text)',
        borderColor: isVrc ? 'var(--plat-vrc-badge-border)' : 'var(--plat-cvr-badge-border)',
        background: isVrc ? 'var(--plat-vrc-picture-badge-bg)' : 'var(--plat-cvr-picture-badge-bg)'
      }}
    >
      {t(isVrc ? 'friends.platform.vrchatShort' : 'friends.platform.chilloutvrShort')}
    </span>
  )
}

export interface CommunityTileProps {
  platform: Platform
  title: string
  /** Quiet second line (a group code, "Friend", a member count). */
  detail?: string | null
  imageUrl: string | null
  /**
   * `icon` tiles only: a wide picture (a group banner) that fills the space
   * above the name, with the square icon in its corner.
   */
  bannerUrl?: string | null
  /**
   * `square`: a small picture beside the name (people in Search).
   * `wide`: the picture on top (worlds). `icon`: a group's banner above the
   * name with its square icon in the corner (the Groups page), wider than tall.
   */
  shape?: 'square' | 'wide' | 'icon'
  /** Opens a sheet; omitted for display-only tiles. */
  onOpen?: (opener: HTMLElement) => void
  ariaLabel?: string
}

/**
 * One person, group or world as a picture tile. The picture loads through
 * main's image proxy when the tile nears the viewport. Until then, or without
 * one, a person or group shows the name's first letter and a world a neutral
 * fill. Memoized: a page can hold many tiles.
 */
export const CommunityTile = memo(function CommunityTile({
  platform,
  title,
  detail = null,
  imageUrl,
  bannerUrl = null,
  shape = 'square',
  onOpen,
  ariaLabel
}: CommunityTileProps): React.JSX.Element {
  const pictureRef = useRef<HTMLDivElement>(null)
  // Wide tiles are world pictures: ask for the sharp copy. Square ones stay small.
  const {
    dataUrl: image,
    pending,
    instant
  } = useAvatarImage(imageUrl, pictureRef, shape === 'wide' ? 'picture' : 'original')
  const [failedImage, setFailedImage] = useState<string | null>(null)
  // A picture that arrives after the page is up fades in instead of popping;
  // one already loaded this session shows at once.
  const arrive = instant ? '' : ' picture-arrive'
  // The banner is asked for only once the icon has an answer (shown, failed
  // to download or draw, or there is none), so a page of groups fills in with
  // icons first and the banners follow, instead of every tile waiting on two
  // pictures at once.
  const bannerWanted =
    shape === 'icon' && (imageUrl === null || image !== null || failedImage !== null || !pending)
  const bannerRef = useRef<HTMLDivElement>(null)
  // Banners show wide: the sharp, card-sized copy, shared with the group sheet.
  const banner = useAvatar(bannerWanted ? bannerUrl : null, bannerRef, 'picture')
  const [failedBanner, setFailedBanner] = useState<string | null>(null)
  const bannerShown = banner !== null && failedBanner !== banner ? banner : null
  const isVrc = platform === 'vrchat'
  const picture =
    image && failedImage !== image ? (
      <img
        src={image}
        alt=""
        decoding="async"
        className={`h-full w-full object-cover${arrive}`}
        onError={() => setFailedImage(image)}
      />
    ) : null
  const name = (
    <span
      className="block truncate text-[14px] font-bold leading-[1.35] text-[var(--text)]"
      title={title}
    >
      {title}
    </span>
  )
  const shown = image && failedImage !== image ? image : null
  // While a picture is still on its way the box breathes softly instead of
  // showing the "no picture" letter, so a page of tiles fills in calmly.
  const waiting = shown === null && pending
  const pictureState = shown ? 'image' : waiting ? 'loading' : 'initial'
  const waitingClass = waiting ? ' picture-waiting' : ''
  // People: a small square picture beside the name, so a page of them stays
  // scannable; with no picture, the name's first letter, as friend pictures
  // have. Worlds: the picture on top, like Explore. The Groups page: the
  // group's wide banner on top with its square icon in the corner, so a
  // square logo is never stretched or cropped. Without a banner, a soft
  // blurred copy of the icon fills the space instead, and with no picture at
  // all the name's first letter on the platform color takes the icon's place.
  const body =
    shape === 'icon' ? (
      <>
        <div
          ref={pictureRef}
          data-community-tile-picture={pictureState}
          className="glass-clip-top relative h-[112px] shrink-0 overflow-hidden bg-[var(--surface-hover)]"
        >
          <div
            ref={bannerRef}
            aria-hidden="true"
            data-community-tile-banner={bannerShown ? 'image' : 'none'}
            className="absolute inset-0"
          >
            {bannerShown ? (
              <img
                src={bannerShown}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="group-banner-in h-full w-full object-cover"
                onError={() => setFailedBanner(bannerShown)}
              />
            ) : shown ? (
              <img
                src={shown}
                alt=""
                aria-hidden="true"
                decoding="async"
                className={`h-full w-full scale-150 object-cover opacity-60 blur-2xl${arrive}`}
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background: isVrc
                    ? 'linear-gradient(135deg, var(--plat-vrc-ghost-border), transparent 75%)'
                    : 'linear-gradient(135deg, var(--plat-cvr-ghost-border), transparent 75%)'
                }}
              />
            )}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: 'var(--group-banner-scrim)' }}
            />
          </div>
          <div
            className={`absolute bottom-[var(--space-2)] left-[var(--space-3)] flex h-[56px] w-[56px] items-center justify-center overflow-hidden rounded-[14px] border-2 border-[var(--group-icon-ring)] shadow-[var(--group-icon-shadow)]${waitingClass}`}
            style={{
              background: isVrc ? 'var(--plat-vrc-rail-bg)' : 'var(--plat-cvr-rail-bg)',
              color: isVrc ? 'var(--plat-vrc-rail-text)' : 'var(--plat-cvr-rail-text)'
            }}
          >
            {shown ? (
              <img
                src={shown}
                alt=""
                decoding="async"
                className={`h-full w-full object-cover${arrive}`}
                onError={() => setFailedImage(shown)}
              />
            ) : waiting ? null : (
              <span aria-hidden="true" className="text-[24px] font-bold leading-none">
                {initialOf(title)}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[var(--space-1)] px-[var(--space-3)] py-[var(--space-2)]">
          {name}
          <span className="flex min-w-0 items-center gap-[var(--space-2)] text-xs text-[var(--text-dim)]">
            <PictureBadge platform={platform} inline />
            {detail ? (
              <span className="truncate" title={detail}>
                {detail}
              </span>
            ) : null}
          </span>
        </div>
      </>
    ) : shape === 'square' ? (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-[var(--space-3)] p-[var(--space-2)]">
          <div
            ref={pictureRef}
            data-community-tile-picture={pictureState}
            className={`relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[var(--surface-hover)]${waitingClass}`}
          >
            {picture ??
              (waiting ? null : (
                <span aria-hidden="true" className="text-lg font-semibold text-[var(--text-dim)]">
                  {initialOf(title)}
                </span>
              ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
            {name}
            <span className="flex min-w-0 items-center gap-[var(--space-2)] text-xs text-[var(--text-dim)]">
              <PictureBadge platform={platform} inline />
              {detail ? (
                <span className="truncate" title={detail}>
                  {detail}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </>
    ) : (
      <>
        <div
          ref={pictureRef}
          className={`glass-clip-top relative aspect-[4/3] shrink-0 overflow-hidden bg-[var(--surface-hover)]${waitingClass}`}
        >
          {picture}
          <PictureBadge platform={platform} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-0-5)] p-[var(--space-3)]">
          {name}
          {detail ? (
            <span className="block truncate text-xs text-[var(--text-dim)]" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
      </>
    )
  const className = `glass glass-layer ${isVrc ? 'tint-vrc' : 'tint-cvr'} relative flex h-full w-full min-w-0 flex-col p-0 text-left`
  if (!onOpen) {
    return (
      <div className={className} data-community-tile="">
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-community-sheet-opener=""
      data-community-tile=""
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={ariaLabel}
      className={`${className} glass-hover focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)]`}
    >
      {body}
    </button>
  )
})

/** Tiles in a responsive grid; `min` is the narrowest a tile may get. */
export function TileGrid({
  min = 150,
  children
}: {
  min?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: 'var(--space-3)'
      }}
    >
      {children}
    </div>
  )
}
