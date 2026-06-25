import { useTranslation } from 'react-i18next'
import type { Friend, InstanceType } from '@shared/types'
import { useFriends } from '../queries/friends'
import OpennessIcon from './OpennessIcon'
import PlatformGlyph from './PlatformGlyph'

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

/**
 * Whether Ask Me / DND should hide the world (DESIGN.md §5 / R6).
 * Only applies to VRChat — CVR has no status.
 */
function isWorldHidden(friend: Friend): boolean {
  return friend.platform === 'vrchat' && (friend.status === 'ask-me' || friend.status === 'dnd')
}

/**
 * Platform spine — 3px glowing left edge, VRChat blue or CVR orange (DESIGN.md §9/§235).
 *
 * Dark + Light: --vrc/--cvr fill; glow via color-mix so tokens flip automatically.
 */
function PlatformSpine({ platform }: { platform: Friend['platform'] }): React.JSX.Element {
  const isVrc = platform === 'vrchat'
  const colorClass = isVrc ? 'bg-[var(--vrc)]' : 'bg-[var(--cvr)]'
  // Glow: 50% platform color into transparent — color-mix avoids raw rgba literals.
  const glowClass = isVrc
    ? 'shadow-[0_0_10px_color-mix(in_srgb,var(--vrc)_50%,transparent)]'
    : 'shadow-[0_0_10px_color-mix(in_srgb,var(--cvr)_50%,transparent)]'

  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 w-[3px] h-[26px] rounded-r-[3px] ${colorClass} ${glowClass}`}
    />
  )
}

function FriendRow({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()
  const statusPill =
    friend.platform === 'vrchat' && friend.status ? STATUS_PILLS[friend.status] : null

  const instance = friend.instance
  const instanceTypeLabelKey =
    instance != null ? (INSTANCE_TYPE_LABEL_KEYS[instance.type] ?? null) : null

  // Ask Me / DND hide the world; custom status shown in subline instead (§5 R6).
  const hideWorld = isWorldHidden(friend)

  // Custom status text — VRChat only. For non-hidden statuses (join-me/online) it
  // appears on the name line; for ask-me/dnd it moves to the subline. Either way
  // it appears exactly once.
  const customStatus = friend.platform === 'vrchat' ? (friend.statusDescription ?? null) : null

  return (
    <li
      className={[
        // grid: 3px spine · 1fr content · auto affordance
        // 42px avatar col is deferred (VRX-48) — added when avatar column lands
        'grid grid-cols-[3px_1fr_auto] items-center gap-x-[13px]',
        'rounded-[13px] py-[9px] pr-[12px]',
        'hover:bg-[var(--surface-hover)] motion-safe:transition-colors'
      ].join(' ')}
    >
      {/* Platform spine — glowing 3px left edge (§9) */}
      <PlatformSpine platform={friend.platform} />

      {/* Content column: name line + subline */}
      <div className="min-w-0">
        {/* Name line — presence dot · name · V/C glyph · status pill (VRChat only) */}
        <div className="flex items-center gap-[var(--space-3)]">
          <span
            className={`h-[var(--space-2-5)] w-[var(--space-2-5)] shrink-0 rounded-full ${presenceClass(friend.presence.state)}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
            {friend.displayName}
          </span>
          {/* V/C platform glyph (§7/§238) */}
          <PlatformGlyph platform={friend.platform} />
          {/* Custom status text on name line — only for non-hidden statuses (join-me/online).
              For ask-me/dnd it moves to the subline; shown exactly once either way. */}
          {!hideWorld && customStatus && (
            <span className="min-w-0 truncate text-xs text-[var(--text-dim)]">{customStatus}</span>
          )}
          {/* VRChat status pill — only when NOT ask-me/dnd (those still get the pill,
              just no world in the subline). */}
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
        </div>

        {/* Subline — world + openness badge (normal) OR custom status (ask-me/dnd) */}
        {hideWorld ? (
          // Ask Me / DND: show custom status text if present; otherwise empty subline.
          customStatus ? (
            <span className="mt-[1px] block truncate text-[12.5px] text-[var(--text-dim)]">
              {customStatus}
            </span>
          ) : null
        ) : instance != null ? (
          <span className="mt-[1px] flex items-center gap-[var(--space-1-5)] truncate text-[12.5px] text-[var(--text-dim)]">
            <span className="min-w-0 truncate">
              {instance.worldName ?? t('friends.instance.unknownWorld')}
            </span>
            {instanceTypeLabelKey != null && (
              <>
                <span className="text-[var(--text-faint)]" aria-hidden="true">
                  ·
                </span>
                <OpennessIcon instanceType={instance.type} label={t(instanceTypeLabelKey)} />
              </>
            )}
          </span>
        ) : null}
      </div>

      {/* Auto column — reserved for the Join/Ask/⊘ affordance (deferred: VRX-166) */}
      <span aria-hidden="true" />
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
