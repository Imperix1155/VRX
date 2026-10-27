import { memo, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarItem } from '@shared/avatarLibrary'
import { useAvatar } from '../hooks/useAvatar'

export interface AvatarCardProps {
  avatar: AvatarItem
  /** The user wears this avatar now. */
  worn: boolean
  onOpen: (avatar: AvatarItem, opener: HTMLElement) => void
  /**
   * `card` (default): picture on top, for the uploads grid. `bar`: picture on
   * the left, for the one "Wearing now" avatar above the grid.
   */
  layout?: 'card' | 'bar'
}

/**
 * One avatar on the Avatars page. VRChat and ChilloutVR use this exact card;
 * only the platform stripe, tint and short label differ. The picture loads
 * through main's image proxy when the card nears the viewport. Memoized: a
 * library can hold hundreds of cards, and opening a details sheet or a Refresh
 * press must not re-render every one of them.
 */
function AvatarCard({ avatar, worn, onOpen, layout = 'card' }: AvatarCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const pictureRef = useRef<HTMLDivElement>(null)
  const image = useAvatar(avatar.imageUrl, pictureRef)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const wornId = useId()
  const isVrc = avatar.platform === 'vrchat'
  const platformLabel = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  const bar = layout === 'bar'

  return (
    <button
      type="button"
      data-avatar-sheet-opener
      data-avatar-card-layout={layout}
      onClick={(event) => onOpen(avatar, event.currentTarget)}
      aria-label={t('avatars.openAria', { name: avatar.name, platform: platformLabel })}
      aria-describedby={worn ? wornId : undefined}
      className={`glass glass-information ${isVrc ? 'tint-vrc' : 'tint-cvr'} relative flex w-full min-w-0 flex-col overflow-hidden p-0 text-left hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter] ${bar ? '' : 'h-full'}`}
    >
      <div
        aria-hidden="true"
        className="h-[4px] w-full shrink-0"
        style={{
          background: isVrc
            ? 'linear-gradient(90deg, var(--vrc), transparent)'
            : 'linear-gradient(90deg, var(--cvr), transparent)'
        }}
      />
      <div className={bar ? 'flex min-w-0 items-stretch' : 'flex flex-1 flex-col'}>
        <div
          ref={pictureRef}
          className={`relative aspect-[4/3] shrink-0 overflow-hidden bg-[var(--surface-hover)] ${bar ? 'w-[128px]' : ''}`}
        >
          {image && failedImage !== image ? (
            <img
              src={image}
              alt=""
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setFailedImage(image)}
            />
          ) : null}
          <span
            aria-hidden="true"
            className="absolute left-[var(--space-2)] top-[var(--space-2)] rounded-[9px] border px-[var(--space-2)] py-[var(--space-0-5)] text-[10px] font-bold"
            style={{
              color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)',
              borderColor: isVrc ? 'var(--plat-vrc-ghost-border)' : 'var(--plat-cvr-ghost-border)',
              // Same small backing as other pills over a picture.
              background: 'color-mix(in srgb, var(--glass-information) 78%, transparent)'
            }}
          >
            {t(isVrc ? 'friends.platform.vrchatShort' : 'friends.platform.chilloutvrShort')}
          </span>
        </div>
        <div
          className={`flex min-w-0 flex-1 flex-col gap-[var(--space-1)] p-[var(--space-3)] ${bar ? 'justify-center' : ''}`}
        >
          <span
            className={`block truncate font-bold leading-[1.35] text-[var(--text)] ${bar ? 'text-[18px]' : 'text-[14.5px]'}`}
            title={avatar.name}
          >
            {avatar.name}
          </span>
          {worn ? (
            <span id={wornId} className="text-xs font-semibold text-[var(--text)]">
              {t('avatars.wearingNow')}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

export default memo(AvatarCard)
