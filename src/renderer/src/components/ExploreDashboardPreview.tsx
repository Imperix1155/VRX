import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import ExploreWorldCard from './ExploreWorldCard'

export interface ExploreDashboardPreviewProps {
  worlds: readonly ExploreWorld[]
  images?: Readonly<Record<string, string | undefined>>
  onOpenWorld: (world: ExploreWorld, opener: HTMLElement) => void
}

/** Dashboard composition receives the same selector output, already capped to two. */
export default function ExploreDashboardPreview({
  worlds,
  images,
  onOpenWorld
}: ExploreDashboardPreviewProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (worlds.length === 0) return null
  return (
    <section className="mb-[var(--space-6)]" aria-labelledby="dashboard-popular-heading">
      <h2
        id="dashboard-popular-heading"
        className="font-[family-name:var(--font-mono)] text-[20px] tracking-[0.08em] text-[var(--text)]"
      >
        {t('explore.popularNow')}
      </h2>
      <div className="mt-[var(--space-3)] grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
        {worlds.slice(0, 2).map((world) => (
          <ExploreWorldCard
            key={`${world.platform}:${world.worldId}`}
            world={world}
            image={images?.[world.worldRef]}
            onOpen={onOpenWorld}
          />
        ))}
      </div>
    </section>
  )
}
