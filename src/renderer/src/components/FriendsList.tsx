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
    <li className="flex items-center gap-3 rounded-control px-3 py-2 hover:bg-white/5">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${presenceClass(friend.presence)}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">
        {friend.displayName}
      </span>
      {friend.statusDescription && (
        <span className="shrink-0 max-w-[160px] truncate text-xs text-[var(--text-dim)]">
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
    <section className="rounded-panel border border-white/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase">
          {t('friends.title')}
        </h2>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label={t('friends.refresh')}
          className="rounded-control px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-white/5 disabled:opacity-50 motion-safe:transition-colors"
        >
          {t('friends.refresh')}
        </button>
      </div>
      {isPending && <p className="text-sm text-[var(--text-faint)]">{t('friends.loading')}</p>}
      {/* Stale-while-revalidate: only surface the error when there's no cached data;
          a background refetch failure keeps showing the last good list. */}
      {isError && !friends && <p className="text-sm text-red-400">{t('friends.error')}</p>}
      {friends && friends.length === 0 && (
        <p className="text-sm text-[var(--text-faint)]">{t('friends.empty')}</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {friends?.map((f) => (
          <FriendRow key={`${f.platform}:${f.platformUserId}`} friend={f} />
        ))}
      </ul>
    </section>
  )
}
