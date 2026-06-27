import { useTranslation } from 'react-i18next'
import type { Friend, InstanceType } from '@shared/types'
import { useFriends } from '../queries/friends'

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

// ─── Status ring (DESIGN.md §9.1) ─────────────────────────────────────────────
// The avatar's status-color ring + glyph REPLACE the old presence-dot + status-pill
// (§5/R6/R10 carve-out): the ring carries the hue, the glyph is the non-color
// signal, and the avatar's aria-label exposes the status TEXT (so status is never
// color-only). The two §5 axes stay distinct — STATUS drives the ring; PRESENCE
// (in a world or not) drives the world subline.

type GlyphKind = 'check' | 'enter' | 'question' | 'minus' | 'gamepad' | 'dot' | null

interface Ring {
  colorVar: string
  glyph: GlyphKind
  labelKey: string
}

const STATUS_RING: Record<NonNullable<Friend['status']>, Ring> = {
  'join-me': { colorVar: '--st-joinme', glyph: 'enter', labelKey: 'friends.status.joinMe' },
  online: { colorVar: '--st-online', glyph: 'check', labelKey: 'friends.status.online' },
  'ask-me': { colorVar: '--st-askme', glyph: 'question', labelKey: 'friends.status.askMe' },
  dnd: { colorVar: '--st-dnd', glyph: 'minus', labelKey: 'friends.status.dnd' }
}

const PRESENCE_RING: Record<Friend['presence']['state'], Ring> = {
  'in-game': { colorVar: '--ingame', glyph: 'gamepad', labelKey: 'friends.presence.inGame' },
  active: { colorVar: '--active', glyph: 'dot', labelKey: 'friends.presence.active' },
  offline: { colorVar: '--offline', glyph: null, labelKey: 'friends.presence.offline' }
}

/**
 * The ring for a friend: VRChat folds its STATUS into the ring; CVR (and any friend
 * without a status, e.g. offline) falls back to the PRESENCE state.
 */
function ringFor(friend: Friend): Ring {
  if (friend.platform === 'vrchat' && friend.status) return STATUS_RING[friend.status]
  return PRESENCE_RING[friend.presence.state]
}

/**
 * Whether Ask Me / DND should hide the world (DESIGN.md §5 / R6).
 * Only applies to VRChat — CVR has no status.
 */
function isWorldHidden(friend: Friend): boolean {
  return friend.platform === 'vrchat' && (friend.status === 'ask-me' || friend.status === 'dnd')
}

/** Small inline status glyph (knocked out to the page bg on the colored badge). */
function StatusGlyph({ kind }: { kind: GlyphKind }): React.JSX.Element | null {
  if (kind == null) return null
  const stroke = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }
  switch (kind) {
    case 'check':
      return (
        <svg {...stroke}>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      )
    case 'enter':
      return (
        <svg {...stroke}>
          <path d="M4 12h11" />
          <path d="M11 8l4 4-4 4" />
        </svg>
      )
    case 'question':
      return (
        <svg {...stroke}>
          <path d="M9 9.3a3 3 0 1 1 4 2.8c-1 .5-1.5 1.1-1.5 2.2" />
          <path d="M11.5 17.6h.01" strokeWidth={3.2} />
        </svg>
      )
    case 'minus':
      return (
        <svg {...stroke}>
          <path d="M6 12h12" />
        </svg>
      )
    case 'gamepad':
      return (
        <svg {...stroke}>
          <rect x="3" y="8.5" width="18" height="8" rx="4" />
          <path d="M7.3 11v3M5.8 12.5h3" />
          <path d="M15.6 12h.01M17.6 13.6h.01" strokeWidth={3.2} />
        </svg>
      )
    case 'dot':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      )
    default:
      return null
  }
}

/**
 * Platform spine — 3px glowing left edge, VRChat blue or CVR orange (DESIGN.md §9/§9.1).
 * After §9.1 this is the row's PRIMARY platform signal (the V/C glyph was dropped).
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

/**
 * Avatar disc — initial placeholder (real images are VRX-48; the renderer CSP blocks
 * remote `img-src`), wrapped in the status-color ring with a status glyph badge.
 */
function Avatar({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()
  const ring = ringFor(friend)
  const initial = friend.displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      role="img"
      aria-label={t(ring.labelKey)}
      className="relative block h-[42px] w-[42px] shrink-0"
    >
      <span
        className="grid h-[42px] w-[42px] place-items-center rounded-full text-sm font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
        style={{ boxShadow: `0 0 0 2.5px var(${ring.colorVar})` }}
      >
        {initial}
      </span>
      {ring.glyph && (
        <span
          className="absolute -right-px -bottom-px grid h-[16px] w-[16px] place-items-center rounded-full border-2 border-[var(--bg-base)] [&>svg]:block [&>svg]:h-[10px] [&>svg]:w-[10px]"
          style={{ background: `var(${ring.colorVar})`, color: 'var(--bg-base)' }}
          aria-hidden="true"
        >
          <StatusGlyph kind={ring.glyph} />
        </span>
      )}
    </span>
  )
}

function FriendRow({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()

  // Custom status — VRChat only; sits BESIDE the name for every status (§9.1).
  const customStatus = friend.platform === 'vrchat' ? (friend.statusDescription ?? null) : null

  // Ask Me / DND hide the world entirely (§5 R6); the world is the subline otherwise.
  const hideWorld = isWorldHidden(friend)
  const instance = friend.instance
  const worldText =
    !hideWorld && instance != null
      ? (instance.worldName ?? t('friends.instance.unknownWorld'))
      : null

  // Instance pill (right): the accurate openness label when the instance is visible
  // (this is the §9.1 join target once join IPC lands — VRX-166), or "Private" when an
  // Ask Me / DND friend is in a (hidden) world. Nothing when there's no instance to act
  // on — offline, in-menu, or Ask Me/DND while only `active` (state distinguishes
  // in-a-hidden-world from in-the-menu even though the location itself is hidden).
  let instancePill: string | null = null
  let pillJoinable = false
  if (hideWorld) {
    if (friend.presence.state === 'in-game') instancePill = t('friends.instance.private')
  } else if (instance != null) {
    instancePill = t(INSTANCE_TYPE_LABEL_KEYS[instance.type] ?? 'friends.instance.unknownWorld')
    pillJoinable = true
  }

  return (
    <li
      className={[
        // grid: 3px spine · 42px avatar · 1fr content · auto instance pill
        'grid grid-cols-[3px_42px_1fr_auto] items-center gap-x-[12px]',
        'rounded-[13px] py-[8px] pr-[12px] pl-[10px]',
        'border border-[color-mix(in_srgb,var(--text)_7%,transparent)]',
        'bg-[color-mix(in_srgb,var(--text)_4%,transparent)]',
        'hover:bg-[var(--surface-hover)] motion-safe:transition-colors'
      ].join(' ')}
    >
      <PlatformSpine platform={friend.platform} />
      <Avatar friend={friend} />

      {/* Content — name + custom status (beside), world beneath */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-[8px]">
          <span className="max-w-[68%] shrink-0 truncate text-sm font-semibold text-[var(--text)]">
            {friend.displayName}
          </span>
          {customStatus && (
            <span className="min-w-0 truncate text-xs text-[var(--text-dim)]">{customStatus}</span>
          )}
        </div>
        {/* World subline — fixed height keeps every row the same height (§9.1). */}
        <span className="mt-[1px] block h-[16px] truncate text-[12.5px] leading-[16px] text-[var(--text-dim)]">
          {worldText}
        </span>
      </div>

      {/* Instance pill — same width column, centered (§9.1). Visual affordance now;
          the clickable join lands with VRX-166. */}
      {instancePill != null ? (
        <span
          className={[
            'inline-flex h-[28px] min-w-[78px] shrink-0 items-center justify-center',
            'rounded-[10px] border px-[12px] text-[12px] font-semibold whitespace-nowrap',
            'bg-[color-mix(in_srgb,var(--text)_5%,transparent)]',
            pillJoinable
              ? 'border-[color-mix(in_srgb,var(--text)_13%,transparent)] text-[var(--text-dim)]'
              : 'border-[color-mix(in_srgb,var(--text)_9%,transparent)] text-[var(--text-faint)]'
          ].join(' ')}
        >
          {instancePill}
        </span>
      ) : (
        <span aria-hidden="true" />
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
      <ul className="flex flex-col gap-[var(--space-1)]">
        {friends?.map((f) => (
          <FriendRow key={`${f.platform}:${f.platformUserId}`} friend={f} />
        ))}
      </ul>
    </section>
  )
}
