import { useTranslation } from 'react-i18next'
import type { ExplorePlatformSnapshot, ExploreWorld } from '@shared/explore'
import ExploreWorldCard from './ExploreWorldCard'
import ExploreSourceState from './ExploreSourceState'
import { isPopularNowHidden } from '../utils/popularNow'

type CardLayout = 'card' | 'bar'

/**
 * The Dashboard's Popular now section: heading, source state, and the card
 * grid. The app (`ExploreDashboardPreviewRoute`) and the design guide both
 * render it, so the guide shows the shipped markup.
 */
export function PopularNowSection({
  platformSnapshots,
  hasCards,
  cardLayout,
  cards,
  children
}: {
  platformSnapshots: readonly ExplorePlatformSnapshot[]
  hasCards: boolean
  cardLayout: CardLayout
  cards: React.ReactNode
  /** Rendered after the grid (the app's world sheet). */
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="mb-[var(--space-6)]" aria-labelledby="dashboard-popular-heading">
      <h2
        id="dashboard-popular-heading"
        className="canvas-text font-[family-name:var(--font-mono)] text-[20px] font-normal tracking-[0.08em] text-[var(--text-faint)]"
      >
        {t('explore.popularNow')}
      </h2>
      <div className="mt-[var(--space-2)]">
        <ExploreSourceState sources={platformSnapshots} hasUsableCards={hasCards} />
      </div>
      {!hasCards ? null : cardLayout === 'bar' ? (
        // Bar cards share the Hot Instances bar grid (main.css), so the second
        // Dashboard section lays out the same whichever section it is.
        <div className="hotwrap mt-[var(--space-3)]">
          <div className="hot-grid hot-grid--flush">{cards}</div>
        </div>
      ) : (
        <div className="picture-gridwrap mt-[var(--space-3)]">
          <div className="picture-grid">{cards}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export interface ExploreDashboardPreviewProps {
  worlds: readonly ExploreWorld[]
  platformSnapshots: readonly ExplorePlatformSnapshot[]
  images?: Readonly<Record<string, string | undefined>>
  onOpenWorld: (world: ExploreWorld, opener: HTMLElement) => void
  /** `bar` when Popular now is the second Dashboard section. */
  cardLayout?: CardLayout
}

/** Fixture-fed Popular now (design guide): same section, cards from props. */
export default function ExploreDashboardPreview({
  worlds,
  platformSnapshots,
  images,
  onOpenWorld,
  cardLayout = 'card'
}: ExploreDashboardPreviewProps): React.JSX.Element | null {
  if (isPopularNowHidden(worlds, platformSnapshots)) return null
  return (
    <PopularNowSection
      platformSnapshots={platformSnapshots}
      hasCards={worlds.length > 0}
      cardLayout={cardLayout}
      cards={worlds.slice(0, 2).map((world) => (
        <ExploreWorldCard
          key={`${world.platform}:${world.worldId}`}
          world={world}
          image={images?.[world.worldRef]}
          onOpen={onOpenWorld}
          layout={cardLayout}
        />
      ))}
    />
  )
}
