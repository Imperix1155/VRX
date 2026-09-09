import { useTranslation } from 'react-i18next'
import type { ExplorePlatformSnapshot } from '@shared/explore'

/** Shared named source truth for the Explore grid and Dashboard preview. */
export default function ExploreSourceState({
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
