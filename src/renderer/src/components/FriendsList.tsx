import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import { useFriendsStore } from '../stores/friends'

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
  const { friends, loading, error, fetchFriends } = useFriendsStore()

  useEffect(() => {
    fetchFriends('vrchat')
  }, [fetchFriends])

  return (
    <section className="rounded-panel border border-white/10 p-4">
      <h2 className="mb-3 font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase">
        {t('friends.title')}
      </h2>
      {loading && <p className="text-sm text-[var(--text-faint)]">{t('friends.loading')}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && friends.length === 0 && (
        <p className="text-sm text-[var(--text-faint)]">{t('friends.empty')}</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {friends.map((f) => (
          <FriendRow key={`${f.platform}:${f.platformUserId}`} friend={f} />
        ))}
      </ul>
    </section>
  )
}
