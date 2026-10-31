import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ExploreCount, ExploreWorld } from '@shared/explore'
import InstancePill from './InstancePill'
import PlatformPill from './PlatformPill'
import { CardPictureBackdrop, PictureBackedPill } from './CardPictureBackdrop'
import { formatCount } from '../utils/exploreFormat'

export interface ExploreWorldCardProps {
  world: ExploreWorld
  /** A renderer-safe, already-resolved image. This component never reads API URLs. */
  image?: string
  onOpen: (world: ExploreWorld, opener: HTMLElement) => void
  /**
   * `card` (default): the full picture-first card. `bar`: the compact Dashboard
   * bar used when Popular now is the second section (owner, 2026-10-18). It
   * borrows the Hot Instances bar grid, with the world picture behind it.
   */
  layout?: 'card' | 'bar'
}

/** "People: 12" with the value in `value` (the bar bolds it). The label and its
 *  punctuation stay in the translation string. */
function People({
  count,
  value = <span />
}: {
  count: ExploreCount
  value?: React.JSX.Element
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <Trans
      i18nKey="explore.peopleCount"
      values={{
        count:
          count.state === 'complete'
            ? formatCount(count.value, i18n.language)
            : t('explore.unknownCount')
      }}
      components={{ value }}
    />
  )
}

/** Shared world-first card for Explore and the Dashboard's Popular now preview. */
export default function ExploreWorldCard({
  world,
  image,
  onOpen,
  layout = 'card'
}: ExploreWorldCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const isVrc = world.platform === 'vrchat'
  const platformLabel = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  // The button's name is the world and platform; the People line is its description.
  const peopleId = useId()

  if (layout === 'bar') {
    const barImage = image && failedImage !== image ? image : null
    return (
      <button
        type="button"
        data-explore-sheet-opener
        data-explore-card-layout="bar"
        onClick={(event) => onOpen(world, event.currentTarget)}
        aria-label={t('explore.openWorldAria', { world: world.name, platform: platformLabel })}
        aria-describedby={peopleId}
        className={`glass glass-information ${isVrc ? 'tint-vrc' : 'tint-cvr'} relative block w-full min-w-0 overflow-hidden p-0 text-left hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]`}
      >
        <CardPictureBackdrop
          image={barImage}
          platform={world.platform}
          onError={() => setFailedImage(image ?? null)}
        />
        <div
          aria-hidden="true"
          className="relative h-[4px] w-full"
          style={{
            background: isVrc
              ? 'linear-gradient(90deg, var(--vrc), transparent)'
              : 'linear-gradient(90deg, var(--cvr), transparent)'
          }}
        />
        <div
          className="relative p-[14px_16px]"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(78px, max-content)',
            gridTemplateRows: 'auto 1fr',
            columnGap: '12px',
            rowGap: '16px',
            minHeight: '96px'
          }}
        >
          <h3
            className="col-start-1 row-start-1 self-center min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[25px] font-bold leading-[1.5] text-[var(--text)]"
            title={world.name}
          >
            {world.name}
          </h3>
          <PictureBackedPill
            backed={barImage !== null}
            className="col-start-2 row-start-1 self-center"
          >
            <InstancePill label={t('explore.viewRooms')} tier={null} className="w-full" />
          </PictureBackedPill>
          <span
            id={peopleId}
            className="col-start-1 row-start-2 self-end min-w-0 truncate text-[13.5px] leading-[1.2] text-[var(--text-dim)]"
          >
            <People
              count={world.activity}
              value={<span className="font-bold text-[var(--text)]" />}
            />
          </span>
          <PictureBackedPill
            backed={barImage !== null}
            className="col-start-2 row-start-2 self-end"
          >
            <PlatformPill platform={world.platform} className="w-full" />
          </PictureBackedPill>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-explore-sheet-opener
      onClick={(event) => onOpen(world, event.currentTarget)}
      aria-label={t('explore.openWorldAria', { world: world.name, platform: platformLabel })}
      aria-describedby={peopleId}
      className={`glass glass-information ${isVrc ? 'tint-vrc' : 'tint-cvr'} group relative flex h-full w-full min-w-0 flex-col overflow-hidden p-0 text-left hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]`}
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
            color: isVrc ? 'var(--plat-vrc-badge-text)' : 'var(--plat-cvr-badge-text)',
            borderColor: isVrc ? 'var(--plat-vrc-badge-border)' : 'var(--plat-cvr-badge-border)',
            background: isVrc
              ? 'var(--plat-vrc-picture-badge-bg)'
              : 'var(--plat-cvr-picture-badge-bg)'
          }}
        >
          {t(isVrc ? 'friends.platform.vrchatShort' : 'friends.platform.chilloutvrShort')}
        </span>
      </div>
      <div className="relative flex flex-1 flex-col gap-[var(--space-2)] p-[var(--space-3)]">
        <h3
          className="truncate text-[18px] font-bold leading-[1.35] text-[var(--text)]"
          title={world.name}
        >
          {world.name}
        </h3>
        <div className="flex flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-xs text-[var(--text-dim)]">
          <span id={peopleId}>
            <People count={world.activity} />
          </span>
        </div>
        <span className="mt-auto text-xs font-semibold text-[var(--text)]">
          {t('explore.viewRooms')}
        </span>
      </div>
    </button>
  )
}
