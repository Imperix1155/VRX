/**
 * Shared pieces of the Search, Groups and Explore list pages and the profile
 * views: the one-line per-platform notice, the picture tile, and the section
 * heading. VRChat and ChilloutVR use the exact same pieces; only the platform
 * stripe, tint and label differ.
 */
import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useAvatar } from '../hooks/useAvatar'
import { useUiStore } from '../stores/ui'
import { platformName, type CommunityNoticeReason, type CommunitySource } from '../utils/community'

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

/** One platform's not-connected, loading or failed line. Ready and idle show nothing. */
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
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  if (state.kind === 'ready' || state.kind === 'idle' || state.kind === 'auth-pending') return null
  const name = platformName(t, platform)

  let text: string
  let action: React.JSX.Element | null = null
  let tone = 'text-[var(--text-dim)]'
  if (state.kind === 'not-connected') {
    text = t(NOT_CONNECTED_KEYS[platform])
    action = (
      <button
        type="button"
        onClick={() => {
          setActiveTab('settings')
          setSettingsCategory('accounts')
        }}
        className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
      >
        {t('community.openAccounts')}
      </button>
    )
  } else if (state.kind === 'failed') {
    text = t(ERROR_KEYS[state.reason], { platform: name })
    tone = 'text-[var(--error)]'
    action =
      onRetry && state.reason !== 'invalid-query' ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('community.retry')}
        </button>
      ) : null
  } else {
    text = t('community.loading', { platform: name })
  }

  return (
    <div
      role={state.kind === 'failed' ? 'alert' : 'status'}
      data-community-notice={platform}
      className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)]"
    >
      {/* The notice text names the platform, so the dot is never the only cue. */}
      <span
        aria-hidden="true"
        className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
        style={{ background: platform === 'vrchat' ? 'var(--vrc)' : 'var(--cvr)' }}
      />
      <p className={`text-sm ${tone}`}>{text}</p>
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
      } rounded-[9px] border px-[var(--space-2)] py-[var(--space-0-5)] text-[10px] font-bold`}
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
  /** `square`: a small picture beside the name (people, groups). `wide`: the picture on top (worlds). */
  shape?: 'square' | 'wide'
  /** Opens a sheet; omitted for display-only tiles. */
  onOpen?: (opener: HTMLElement) => void
  ariaLabel?: string
}

/**
 * One person, group or world as a picture tile. The picture loads through
 * main's image proxy when the tile nears the viewport and falls back to a
 * neutral fill. Memoized: a page can hold many tiles.
 */
export const CommunityTile = memo(function CommunityTile({
  platform,
  title,
  detail = null,
  imageUrl,
  shape = 'square',
  onOpen,
  ariaLabel
}: CommunityTileProps): React.JSX.Element {
  const pictureRef = useRef<HTMLDivElement>(null)
  const image = useAvatar(imageUrl, pictureRef)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const isVrc = platform === 'vrchat'
  const stripe = (
    <div
      aria-hidden="true"
      className="h-[4px] w-full shrink-0"
      style={{
        background: isVrc
          ? 'linear-gradient(90deg, var(--vrc), transparent)'
          : 'linear-gradient(90deg, var(--cvr), transparent)'
      }}
    />
  )
  const picture =
    image && failedImage !== image ? (
      <img
        src={image}
        alt=""
        decoding="async"
        className="h-full w-full object-cover"
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
  // People and groups: a small square picture beside the name, so a page of
  // them stays scannable. Worlds: the picture on top, like Explore.
  const body =
    shape === 'square' ? (
      <>
        {stripe}
        <div className="flex min-w-0 flex-1 items-center gap-[var(--space-3)] p-[var(--space-2)]">
          <div
            ref={pictureRef}
            className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--surface-hover)]"
          >
            {picture}
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
        {stripe}
        <div
          ref={pictureRef}
          className="relative aspect-[4/3] shrink-0 overflow-hidden bg-[var(--surface-hover)]"
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
  const className = `glass glass-information ${isVrc ? 'tint-vrc' : 'tint-cvr'} relative flex h-full w-full min-w-0 flex-col overflow-hidden p-0 text-left`
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
      className={`${className} hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]`}
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
