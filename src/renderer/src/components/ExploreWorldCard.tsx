import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreCount, ExploreWorld } from '@shared/explore'

export interface ExploreWorldCardProps {
  world: ExploreWorld
  /** A renderer-safe, already-resolved image. This component never reads API URLs. */
  image?: string
  onOpen: (world: ExploreWorld, opener: HTMLElement) => void
}

function Count({ count }: { count: ExploreCount }): React.JSX.Element {
  const { t } = useTranslation()
  return <>{count.state === 'complete' ? count.value : t('explore.unknownCount')}</>
}

/** Shared world-first card for Explore and the Dashboard's Popular now preview. */
export default function ExploreWorldCard({
  world,
  image,
  onOpen
}: ExploreWorldCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const isVrc = world.platform === 'vrchat'
  const platformLabel = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  const activityLabel = t(isVrc ? 'explore.peopleInWorld' : 'explore.peopleInPublicRooms')

  return (
    <button
      type="button"
      data-explore-sheet-opener
      onClick={(event) => onOpen(world, event.currentTarget)}
      aria-label={t('explore.openWorldAria', { world: world.name, platform: platformLabel })}
      className={`glass ${isVrc ? 'tint-vrc' : 'tint-cvr'} group relative min-w-0 overflow-hidden p-0 text-left focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)]`}
    >
      <div
        aria-hidden="true"
        className="h-[4px] w-full"
        style={{
          background: isVrc
            ? 'linear-gradient(90deg, var(--vrc), transparent)'
            : 'linear-gradient(90deg, var(--cvr), transparent)'
        }}
      />
      <div className="relative aspect-[16/7] overflow-hidden bg-[var(--surface-hover)]">
        {image && failedImage !== image ? (
          <img
            src={image}
            alt=""
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
            background: 'color-mix(in srgb, var(--bg-base) 55%, transparent)'
          }}
        >
          {isVrc ? 'VRC' : 'CVR'}
        </span>
      </div>
      <div className="relative grid gap-[var(--space-2)] p-[var(--space-3)]">
        <h3
          className="truncate text-[18px] font-bold leading-[1.35] text-[var(--text)]"
          title={world.name}
        >
          {world.name}
        </h3>
        <div className="flex flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-xs text-[var(--text-dim)]">
          <span>
            {activityLabel}: <Count count={world.activity} />
          </span>
          <span>
            {t('explore.visibleRooms')}: <Count count={world.visibleRoomCount} />
          </span>
        </div>
        <span className="text-xs font-semibold text-[var(--text)]">{t('explore.viewRooms')}</span>
      </div>
    </button>
  )
}
