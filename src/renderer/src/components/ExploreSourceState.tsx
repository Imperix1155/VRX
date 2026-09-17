import { useTranslation } from 'react-i18next'
import type { ExplorePlatformSnapshot } from '@shared/explore'

/** Shared initial loading and named failures for Explore and Dashboard. */
export default function ExploreSourceState({
  sources,
  hasUsableCards = false
}: {
  sources: readonly ExplorePlatformSnapshot[]
  /** Existing cards are sufficient feedback during a routine background refresh. */
  hasUsableCards?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const initiallyLoading = sources.some(
    (source) => source.status === 'loading' && (!hasUsableCards || source.worlds.length === 0)
  )
  const statusKey = (source: ExplorePlatformSnapshot): string | null => {
    if (source.status === 'loading') return null
    if (source.status === 'error') return 'explore.sourceState.error'
    if (source.status === 'unavailable') return 'explore.sourceState.unavailable'
    if (source.isStale) return hasUsableCards ? null : 'explore.sourceState.stale'
    return null
  }
  const states = sources
    .map((source) => ({ source, key: statusKey(source) }))
    .filter(
      (entry): entry is { source: ExplorePlatformSnapshot; key: string } => entry.key !== null
    )
  if (!initiallyLoading && states.length === 0) return null
  return (
    <ul className="grid gap-[var(--space-1)] text-sm">
      {initiallyLoading ? (
        <li className="text-[var(--text-dim)]">{t('explore.sourceState.loading')}</li>
      ) : null}
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
