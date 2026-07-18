/**
 * Avatar disc — main-fetched data URL with the initial placeholder retained for
 * loading/failure, wrapped in the status-color ring (VRX-48, DESIGN.md §9.1).
 * Extracted from FriendsList.tsx (VRX-69) so the friend drawer can reuse it
 * without a FriendsList ⇄ FriendDrawer import cycle.
 *
 * The `row` variant (42px) carries the corner status badge — an empty
 * status-color dot (VRX-69 retired the svg glyph; the aria-label + the
 * drawer's written status band are the non-color signifiers now). The
 * `drawer` variant is 64px with NO badge (owner spec, VRX-69). The ring is
 * 2.5px at both sizes; offline stays badge-less (`ring.glyph === null`).
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import { ringFor } from '../utils/statusRing'
import { useAvatar } from '../hooks/useAvatar'

export function Avatar({
  friend,
  variant = 'row'
}: {
  friend: Friend
  variant?: 'row' | 'drawer'
}): React.JSX.Element {
  const { t } = useTranslation()
  const ring = ringFor(friend)
  const initial = friend.displayName.trim().charAt(0).toUpperCase() || '?'
  const avatarRef = useRef<HTMLSpanElement>(null)
  const dataUrl = useAvatar(friend.avatarUrl, avatarRef)
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null)
  const imageKey = dataUrl ? `${friend.avatarUrl ?? ''}\u0000${dataUrl}` : null
  const isDrawer = variant === 'drawer'
  const sizeClass = isDrawer ? 'h-[64px] w-[64px]' : 'h-[42px] w-[42px]'

  return (
    <span
      ref={avatarRef}
      role="img"
      aria-label={t(ring.labelKey)}
      className={`relative block shrink-0 ${sizeClass}`}
    >
      {dataUrl && imageKey !== failedImageKey ? (
        <img
          src={dataUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedImageKey(imageKey)}
          className={`${sizeClass} rounded-full object-cover`}
          style={{ boxShadow: `0 0 0 2.5px var(${ring.colorVar})` }}
        />
      ) : (
        <span
          className={`grid ${sizeClass} place-items-center rounded-full ${
            isDrawer ? 'text-xl' : 'text-sm'
          } font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]`}
          style={{ boxShadow: `0 0 0 2.5px var(${ring.colorVar})` }}
        >
          {initial}
        </span>
      )}
      {!isDrawer && ring.glyph && (
        <span
          className="absolute -right-px -bottom-px grid h-[16px] w-[16px] place-items-center rounded-full border-2 border-[var(--bg-base)]"
          style={{ background: `var(${ring.colorVar})` }}
          aria-hidden="true"
        />
      )}
    </span>
  )
}
