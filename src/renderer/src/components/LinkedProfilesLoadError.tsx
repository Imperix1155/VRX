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
  if (!query.isError && !retrying) return null
  return (
    <div className="my-[var(--space-3)] text-[13px] text-[var(--text-dim)]">
      <p role="alert">{t('linking.loadFailed')}</p>
      <button
        type="button"
        disabled={query.isFetching || retrying}
        className="mt-[var(--space-2)] rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        onClick={() => {
          setRetrying(true)
          void query.refetch({ cancelRefetch: false }).finally(() => setRetrying(false))
        }}
      >
        {t('linking.retryLoad')}
      </button>
    </div>
  )
}
