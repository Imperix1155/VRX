import { useTranslation } from 'react-i18next'
import type { FriendSourceFailure } from '../queries/friends'

const SOURCE_STATE_KEY = {
  missing: 'friends.sourceState.missing',
  stale: 'friends.sourceState.stale'
} as const

/**
 * Non-blocking per-platform notice for a partial or stale roster (issue 368). The
 * list stays visible; each failed platform gets one line and its own Retry, so
 * retrying never refetches the platform that is working. Follows DESIGN.md
 * §9.4: keep usable content, preserve meaningful errors and stale results.
 */
export default function FriendsSourceNotice({
  failures,
  isFetching
}: {
  failures: readonly FriendSourceFailure[]
  isFetching: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (failures.length === 0) return null
  return (
    <ul
      role="status"
      data-testid="friends-source-notice"
      className="mb-[var(--space-3)] grid gap-[var(--space-1)] text-sm"
    >
      {failures.map((failure) => {
        const platform = t(
          failure.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr'
        )
        return (
          <li
            key={failure.platform}
            className="flex items-center justify-between gap-[var(--space-2)] text-[var(--error)]"
          >
            <span>{t(SOURCE_STATE_KEY[failure.kind], { platform })}</span>
            <button
              type="button"
              disabled={isFetching}
              onClick={failure.retry}
              className="shrink-0 rounded-control border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
            >
              {t(isFetching ? 'friends.sourceState.retrying' : 'friends.sourceState.retry', {
                platform
              })}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
