/**
 * Avatar disc — main-fetched data URL with the initial placeholder retained for
 * loading/failure, wrapped in the status-color ring (VRX-48, DESIGN.md §9.1).
 * Extracted from FriendsList.tsx (VRX-69) so the friend drawer can reuse it
 * without a FriendsList ⇄ FriendDrawer import cycle.
 *
 * The `row` variant (42px) carries the corner status badge — an empty
 * status-color dot (VRX-69 retired the svg glyph; the aria-label + the
 * drawer's written status band are the non-color signifiers now). The
 * `drawer` variant is 64px with NO badge (owner spec, VRX-69). The `small`
 * variant (24px, VRX-250 sheet chips) scales the ring and badge proportionally.
 * Offline stays badge-less (`ring.glyph === null`).
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import { ringFor } from '../utils/statusRing'
import { useAvatar } from '../hooks/useAvatar'

export function Avatar({
  friend,
  variant = 'row',
  ariaLabel
}: {
  friend: Friend
  variant?: 'row' | 'drawer' | 'small'
  /** Accessible-name override (VRX-210: the join dialog names each avatar by
   *  PERSON, not status). Defaults to the status ring's label everywhere else. */
  ariaLabel?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const ring = ringFor(friend)
  const initial = friend.displayName.trim().charAt(0).toUpperCase() || '?'
  const avatarRef = useRef<HTMLSpanElement>(null)
  const dataUrl = useAvatar(friend.avatarUrl, avatarRef)
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null)
  const imageKey = dataUrl ? `${friend.avatarUrl ?? ''}\u0000${dataUrl}` : null
  const isDrawer = variant === 'drawer'
  const isSmall = variant === 'small'
  const sizeClass = isDrawer
    ? 'h-[64px] w-[64px]'
    : isSmall
      ? 'h-[24px] w-[24px]'
      : 'h-[42px] w-[42px]'
  const ringWidth = isDrawer ? 2.5 : isSmall ? 1.5 : 2.5
  const initialClass = isDrawer ? 'text-xl' : isSmall ? 'text-[10px]' : 'text-sm'
  const badgeSize = isSmall ? 'h-[9px] w-[9px]' : 'h-[16px] w-[16px]'

  return (
    <span
      ref={avatarRef}
      role="img"
      aria-label={ariaLabel ?? t(ring.labelKey)}
      className={`relative block shrink-0 ${sizeClass}`}
    >
      {dataUrl && imageKey !== failedImageKey ? (
        <img
          src={dataUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedImageKey(imageKey)}
          className={`${sizeClass} rounded-full object-cover`}
          style={{ boxShadow: `0 0 0 ${ringWidth}px var(${ring.colorVar})` }}
        />
      ) : (
        <span
          className={`grid ${sizeClass} place-items-center rounded-full ${initialClass} font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]`}
          style={{ boxShadow: `0 0 0 ${ringWidth}px var(${ring.colorVar})` }}
        >
          {initial}
        </span>
      )}
      {!isDrawer && ring.glyph && (
        <span
          className={`absolute -right-px -bottom-px grid ${badgeSize} place-items-center rounded-full border-2 border-[var(--bg-base)]`}
          style={{ background: `var(${ring.colorVar})` }}
          aria-hidden="true"
        />
      )}
    </span>
  )
}
