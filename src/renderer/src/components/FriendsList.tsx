import { useTranslation } from 'react-i18next'
import type { Friend, InstanceType } from '@shared/types'
import { useFriends } from '../queries/friends'

const STATUS_PILLS = {
  'join-me': {
    labelKey: 'friends.status.joinMe',
    className:
      'border-[color-mix(in_srgb,var(--st-joinme)_38%,transparent)] bg-[color-mix(in_srgb,var(--st-joinme)_14%,transparent)] text-[var(--st-joinme-text)]',
    dotClassName: 'bg-[var(--st-joinme)]'
  },
  online: {
    labelKey: 'friends.status.online',
    className:
      'border-[color-mix(in_srgb,var(--st-online)_36%,transparent)] bg-[color-mix(in_srgb,var(--st-online)_14%,transparent)] text-[var(--st-online-text)]',
    dotClassName: 'bg-[var(--st-online)]'
  },
  'ask-me': {
    labelKey: 'friends.status.askMe',
    className:
      'border-[color-mix(in_srgb,var(--st-askme)_40%,transparent)] bg-[color-mix(in_srgb,var(--st-askme)_15%,transparent)] text-[var(--st-askme-text)]',
    dotClassName: 'bg-[var(--st-askme)]'
  },
  dnd: {
    labelKey: 'friends.status.dnd',
    className:
      'border-[color-mix(in_srgb,var(--st-dnd)_42%,transparent)] bg-[color-mix(in_srgb,var(--st-dnd)_15%,transparent)] text-[var(--st-dnd-text)]',
    dotClassName: 'bg-[var(--st-dnd)]'
  }
} as const satisfies Record<
  NonNullable<Friend['status']>,
  { labelKey: string; className: string; dotClassName: string }
>

/**
 * Maps each platform-true InstanceType to its i18n key (DESIGN.md §6).
 * Using a lookup map avoids dot-notation issues with hyphenated keys.
 */
const INSTANCE_TYPE_LABEL_KEYS: Record<InstanceType, string> = {
  // VRChat types
  public: 'friends.instance.type.public',
  'friends-plus': 'friends.instance.type.friends-plus',
  friends: 'friends.instance.type.friends',
  'invite-plus': 'friends.instance.type.invite-plus',
  invite: 'friends.instance.type.invite',
  'group-public': 'friends.instance.type.group-public',
  'group-plus': 'friends.instance.type.group-plus',
  group: 'friends.instance.type.group',
  // CVR types
  'friends-of-friends': 'friends.instance.type.friends-of-friends',
  'everyone-can-invite': 'friends.instance.type.everyone-can-invite',
  'owner-must-invite': 'friends.instance.type.owner-must-invite',
  'friends-of-members': 'friends.instance.type.friends-of-members',
  'members-only': 'friends.instance.type.members-only',
  offline: 'friends.instance.type.offline'
}

function presenceClass(state: Friend['presence']['state']): string {
  if (state === 'in-game') return 'bg-[var(--ingame)]'
  if (state === 'active') return 'bg-[var(--active)]'
  return 'bg-[var(--offline)]'
}

function FriendRow({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()
  const statusPill =
    friend.platform === 'vrchat' && friend.status ? STATUS_PILLS[friend.status] : null

  const instance = friend.instance
  const instanceTypeLabelKey =
    instance != null ? (INSTANCE_TYPE_LABEL_KEYS[instance.type] ?? null) : null

  return (
    <li className="flex items-center gap-[var(--space-3)] rounded-control px-[var(--space-3)] py-[var(--space-2)] hover:bg-[var(--surface-hover)]">
      <span
        className={`h-[var(--space-2-5)] w-[var(--space-2-5)] shrink-0 rounded-full ${presenceClass(friend.presence.state)}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--text)]">{friend.displayName}</span>
        {instance != null && (
          <span className="block truncate text-xs text-[var(--text-dim)] motion-safe:transition-colors">
            {instance.worldName ?? t('friends.instance.unknownWorld')}
            {instanceTypeLabelKey != null && (
              <>
                {' · '}
                <span className="text-[var(--text-faint)]">{t(instanceTypeLabelKey)}</span>
              </>
            )}
          </span>
        )}
      </div>
      {statusPill && (
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${statusPill.className}`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusPill.dotClassName}`}
            aria-hidden="true"
          />
          {t(statusPill.labelKey)}
        </span>
      )}
      {friend.platform === 'vrchat' && friend.statusDescription && (
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
