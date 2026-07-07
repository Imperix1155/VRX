import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, InstanceType } from '@shared/types'
import { useFriends, combineFriendQueries } from '../queries/friends'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'

/**
 * Openness-ladder tier per InstanceType (DESIGN.md §6) — keys the pill's `--op-*`
 * color tokens. Friend ladder green→orange (open→locked); groups purple (lighter =
 * more open). `null` = neutral pill (CVR Offline Instance — not joinable).
 */
type OpennessTier =
  | 'public'
  | 'friends-plus'
  | 'friends'
  | 'invite-plus'
  | 'invite'
  | 'group-public'
  | 'group-plus'
  | 'group'

const OPENNESS_TIER: Record<InstanceType, OpennessTier | null> = {
  // VRChat types
  public: 'public',
  'friends-plus': 'friends-plus',
  friends: 'friends',
  'invite-plus': 'invite-plus',
  invite: 'invite',
  'group-public': 'group-public',
  'group-plus': 'group-plus',
  group: 'group',
  // CVR types (same §6 tiers, platform-true labels)
  'friends-of-friends': 'friends-plus',
  'everyone-can-invite': 'invite-plus',
  'owner-must-invite': 'invite',
  'friends-of-members': 'group-plus',
  'members-only': 'group',
  offline: null
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

// memo: the query cache's structuralSharing keeps unchanged Friend object
// references across refetches, so memoizing the row skips re-rendering every
// unchanged friend on each reconcile tick (audit W5 stopgap; virtualization is
// the real fix and lands with VRX-64).
const FriendRow = memo(function FriendRow({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()
  // Store subscription (not a prop) so memo'd rows still re-render on change.
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)

  // Custom status — VRChat only; sits BESIDE the name for every status (§9.1).
  const customStatus = friend.platform === 'vrchat' ? (friend.statusDescription ?? null) : null

  // Ask Me / DND hide the world entirely (§5 R6); the world is the subline otherwise.
  const hideWorld = isWorldHidden(friend)
  const instance = friend.instance
  const worldText =
    !hideWorld && instance != null
      ? (instance.worldName ?? t('friends.instance.unknownWorld'))
      : null

  // Instance pill (right): the accurate openness label — colored by its §6 tier —
  // when the instance is visible (the §9.1 join target once join IPC lands, VRX-166).
  // A friend who is IN A WORLD we can't see gets "Private" — REGARDLESS of status:
  // VRChat reports location "private" for any friend in a private instance (not just
  // Ask Me/DND), so `state` is the truth about being in-world, not `status` (owner
  // rule: never no pill unless they're truly not in a world). Web/app-active friends
  // (state "active") and offline friends are not in any instance → no pill.
  let instancePill: string | null = null
  let pillTier: OpennessTier | null = null
  if (!hideWorld && instance != null) {
    instancePill = t(
      LABEL_KEYS_BY_SCHEME[labelScheme][instance.type] ?? 'friends.instance.unknownWorld'
    )
    pillTier = OPENNESS_TIER[instance.type] ?? null
  } else if (friend.presence.state === 'in-game') {
    instancePill = t('friends.instance.private')
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

      {/* Instance pill — same width column, centered (§9.1); tier-colored per the §6
          openness ladder (inline style: tier→token is runtime lookup, so Tailwind
          can't emit it). Neutral (Private / CVR Offline Instance) pills stay hueless
          but readable. Visual affordance now; the clickable join lands with VRX-166. */}
      {instancePill != null ? (
        <span
          className={[
            'inline-flex h-[28px] min-w-[78px] shrink-0 items-center justify-center',
            'rounded-[10px] border px-[12px] text-[12px] font-semibold whitespace-nowrap'
          ].join(' ')}
          style={
            pillTier != null
              ? {
                  color: `var(--op-${pillTier}-text)`,
                  background: `color-mix(in srgb, var(--op-${pillTier}) 13%, transparent)`,
                  borderColor: `color-mix(in srgb, var(--op-${pillTier}) 36%, transparent)`
                }
              : {
                  color: 'var(--text-dim)',
                  background: 'color-mix(in srgb, var(--text) 7%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--text) 16%, transparent)'
                }
          }
        >
          {instancePill}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  )
})

export default function FriendsList(): React.JSX.Element {
  const { t } = useTranslation()
  // Server data comes from the TanStack Query cache (VRX-22); the Zustand store
  // holds only view state (search/filter/selection). Both platforms are fetched
  // (cached, shared with the Dashboard/TopBar); the filter selects which to show.
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const { friends, isPending, isError, isFetching, refetch } = combineFriendQueries(
    platformFilter,
    useFriends('vrchat'),
    useFriends('chilloutvr')
  )

  return (
    <section
      aria-labelledby="friends-list-heading"
      className="rounded-panel border border-[var(--border)] p-[var(--space-4)]"
    >
      <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-2)]">
        <h2
          id="friends-list-heading"
          className="font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase"
        >
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
