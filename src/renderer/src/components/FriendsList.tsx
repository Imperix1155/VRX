import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import { useFriends } from '../queries/friends'

function presenceClass(presence: Friend['presence']): string {
  if (presence === 'in-game') return 'bg-[var(--ingame)]'
  if (presence === 'active') return 'bg-[var(--active)]'
  return 'bg-[var(--offline)]'
}

function FriendRow({ friend }: { friend: Friend }): React.JSX.Element {
  return (
    <li className="flex items-center gap-[var(--space-3)] rounded-control px-[var(--space-3)] py-[var(--space-2)] hover:bg-[var(--surface-hover)]">
      <span
        className={`h-[var(--space-2-5)] w-[var(--space-2-5)] shrink-0 rounded-full ${presenceClass(friend.presence)}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">
        {friend.displayName}
      </span>
      {friend.statusDescription && (
        <span className="shrink-0 max-w-[var(--friend-status-description-width)] truncate text-xs text-[var(--text-dim)]">
          {friend.statusDescription}
        </span>
      )}
    </li>
  )
}

export default function FriendsList(): React.JSX.Element {
  const { t } = useTranslation()
  // Server data comes from the TanStack Query cache (VRX-22); the Zustand store
  // holds only view state (search/filter/selection).
  const { data: friends, isPending, isError, isFetching, refetch } = useFriends('vrchat')

  return (
    <section className="rounded-panel border border-[var(--border)] p-[var(--space-4)]">
      <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-2)]">
        <h2 className="font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase">
          {t('friends.title')}
        </h2>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label={t('friends.refresh')}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
        >
          {t('friends.refresh')}
        </button>
      </div>
      {isPending && <p className="text-sm text-[var(--text-faint)]">{t('friends.loading')}</p>}
      {/* Stale-while-revalidate: only surface the error when there's no cached data;
          a background refetch failure keeps showing the last good list. */}
      {isError && !friends && <p className="text-sm text-[var(--error)]">{t('friends.error')}</p>}
      {friends && friends.length === 0 && (
        <p className="text-sm text-[var(--text-faint)]">{t('friends.empty')}</p>
      )}
      <ul className="flex flex-col gap-[var(--space-0-5)]">
        {friends?.map((f) => (
          <FriendRow key={`${f.platform}:${f.platformUserId}`} friend={f} />
        ))}
      </ul>
    </section>
  )
}
