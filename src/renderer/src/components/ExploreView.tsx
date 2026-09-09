import { useTranslation } from 'react-i18next'
import type {
  ExplorePlatformSnapshot,
  ExploreRoom,
  ExploreWorld,
  ExploreWorldSnapshot,
  ExploreWorldTotal
} from '@shared/explore'
import { EXPLORE_WORLD_TOTALS } from '@shared/explore'
import NumberStepper from './NumberStepper'
import ExploreWorldCard from './ExploreWorldCard'
import ExploreWorldSheet from './ExploreWorldSheet'

export interface ExploreViewProps {
  worlds: readonly ExploreWorld[]
  total: ExploreWorldTotal
  platformSnapshots: readonly ExplorePlatformSnapshot[]
  sheet: ExploreWorldSnapshot | null
  sheetOpener: HTMLElement | null
  focusFallback: HTMLElement | null
  /** map from opaque worldRef to a renderer-safe image source */
  images?: Readonly<Record<string, string | undefined>>
  onTotalChange: (total: ExploreWorldTotal) => void
  onOpenWorld: (world: ExploreWorld, opener: HTMLElement) => void
  onCloseSheet: () => void
  onJoinRoom: (room: ExploreRoom) => void
}

function SourceState({
  sources
}: {
  sources: readonly ExplorePlatformSnapshot[]
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const statusKey = (source: ExplorePlatformSnapshot): string | null => {
    if (source.status === 'loading') return 'explore.sourceState.loading'
    if (source.status === 'error') return 'explore.sourceState.error'
    if (source.status === 'unavailable') return 'explore.sourceState.unavailable'
    if (source.isStale) return 'explore.sourceState.stale'
    return null
  }
  const states = sources
    .map((source) => ({ source, key: statusKey(source) }))
    .filter(
      (entry): entry is { source: ExplorePlatformSnapshot; key: string } => entry.key !== null
    )
  if (states.length === 0) return null
  return (
    <ul className="grid gap-[var(--space-1)] text-sm">
      {states.map(({ source, key }) => (
        <li
          key={source.platform}
          className={source.status === 'error' ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'}
        >
          {t(key, {
            platform: t(
              source.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr'
            )
          })}
        </li>
      ))}
    </ul>
  )
}

/** Presentational grid. The existing platform selector remains owned by the shell. */
export default function ExploreView({
  worlds,
  total,
  platformSnapshots,
  sheet,
  sheetOpener,
  focusFallback,
  images,
  onTotalChange,
  onOpenWorld,
  onCloseSheet,
  onJoinRoom
}: ExploreViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const shownSources = platformSnapshots.filter(
    (source) => source.worlds.length > 0 || source.status !== 'idle'
  )
  const sheetImage = sheet === null ? undefined : images?.[sheet.world.worldRef]
  const terminalFailure = shownSources.some(
    (source) => source.status === 'error' || source.status === 'unavailable'
  )
  const setTotal = (raw: number): void => {
    if (raw === total) return
    const next =
      raw > total
        ? EXPLORE_WORLD_TOTALS.find((value) => value > total)
        : [...EXPLORE_WORLD_TOTALS].reverse().find((value) => value < total)
    if (next !== undefined) onTotalChange(next)
  }
  return (
    <section aria-labelledby="explore-heading">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
        <div>
          <h1 id="explore-heading" className="text-2xl font-bold text-[var(--text)]">
            {t('explore.heading')}
          </h1>
          <p className="mt-[var(--space-1)] text-sm text-[var(--text-dim)]">
            {t('explore.description')}
          </p>
        </div>
        <div className="flex items-center gap-[var(--space-2)]">
          <span className="text-sm text-[var(--text-dim)]">{t('explore.worldsShown')}</span>
          <NumberStepper
            value={total}
            min={2}
            max={6}
            onChange={setTotal}
            ariaLabel={t('explore.worldsShownAria')}
          />
        </div>
      </div>
      <div className="mt-[var(--space-4)]">
        <SourceState sources={shownSources} />
      </div>
      {worlds.length === 0 &&
      !shownSources.some((source) => source.status === 'loading') &&
      !terminalFailure ? (
        <p className="mt-[var(--space-4)] text-sm text-[var(--text-dim)]">{t('explore.empty')}</p>
      ) : null}
      {worlds.length > 0 ? (
        <div className="mt-[var(--space-4)] grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
          {worlds.map((world) => (
            <ExploreWorldCard
              key={`${world.platform}:${world.worldId}`}
              world={world}
              image={images?.[world.worldRef]}
              onOpen={onOpenWorld}
            />
          ))}
        </div>
      ) : null}
      <ExploreWorldSheet
        snapshot={sheet}
        image={sheetImage}
        opener={sheetOpener}
        focusFallback={focusFallback}
        onClose={onCloseSheet}
        onJoin={onJoinRoom}
      />
    </section>
  )
}
