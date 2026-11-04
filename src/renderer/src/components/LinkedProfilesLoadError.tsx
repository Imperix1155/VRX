import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import type { UseQueryResult } from '@tanstack/react-query'

/** Retry only the local read, coalescing with an already active read. */
export default function LinkedProfilesLoadError({
  query
}: {
  query: UseQueryResult<LinkSnapshot, Error>
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [retrying, setRetrying] = useState(false)
  // A read again after a failure, with nothing loaded yet. Retry's own promise
  // settles a moment before the query's new state reaches this line, so this
  // keeps the line (and focus on Retry) through that moment.
  const rereading = query.status === 'pending' && query.errorUpdatedAt > 0
  if (!query.isError && !retrying && !rereading) return null
  const busy = query.isFetching || retrying
  return (
    <div className="my-[var(--space-3)] text-[13px] text-[var(--text-dim)]">
      <p role="alert">{t('linking.loadFailed')}</p>
      <button
        type="button"
        // Not `disabled` while it reads: keyboard focus stays on Retry, and is
        // still there if the read fails again.
        aria-disabled={busy || undefined}
        className="mt-[var(--space-2)] rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text)] hover:bg-[var(--surface-hover)] aria-disabled:cursor-default aria-disabled:opacity-50"
        onClick={() => {
          if (busy) return
          setRetrying(true)
          void query.refetch({ cancelRefetch: false }).finally(() => setRetrying(false))
        }}
      >
        {t('linking.retryLoad')}
      </button>
    </div>
  )
}
