import { useTranslation } from 'react-i18next'
import type { ExplorePlatformSnapshot } from '@shared/explore'
import type { Platform } from '@shared/types'

/** Shared initial loading and named failures for Explore and Dashboard. */
export default function ExploreSourceState({
  sources,
  hasUsableCards = false,
  onRetry
}: {
  sources: readonly ExplorePlatformSnapshot[]
  /** Existing cards are sufficient feedback during a routine background refresh. */
  hasUsableCards?: boolean
  /**
   * Gives each failed platform its own Retry, as the friends notice does. The
   * Dashboard passes it; Explore has its own Refresh beside the list.
   */
  onRetry?: (platform: Platform) => void
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
    <ul className="canvas-text grid gap-[var(--space-1)] text-sm">
      {initiallyLoading ? (
        <li className="text-[var(--text-dim)]">{t('explore.sourceState.loading')}</li>
      ) : null}
      {states.map(({ source, key }) => {
        const platform = t(
          source.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr'
        )
        const retry = source.status === 'error' && onRetry !== undefined
        return (
          <li
            key={source.platform}
            className={`${retry ? 'flex items-center justify-between gap-[var(--space-2)] ' : ''}${
              source.status === 'error' ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
            }`}
          >
            {retry ? <span>{t(key, { platform })}</span> : t(key, { platform })}
            {retry ? (
              <button
                type="button"
                onClick={() => onRetry(source.platform)}
                className="shrink-0 rounded-control border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
              >
                {t('friends.sourceState.retry', { platform })}
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
