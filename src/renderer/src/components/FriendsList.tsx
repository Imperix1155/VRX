import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, FriendSection, Platform } from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import { useFriends, combineFriendQueries } from '../queries/friends'
import { useAuthStatus } from '../queries/auth'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { groupFriendsBySection } from '../utils/groupFriendsBySection'
import InstancePill from './InstancePill'
import { OPENNESS_TIER, type OpennessTier } from '../utils/instancePill'
import { splitByMatch } from '../utils/splitByMatch'
import { useAvatar } from '../hooks/useAvatar'

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
 * Avatar disc — main-fetched data URL with the initial placeholder retained for
 * loading/failure, wrapped in the status-color ring with a status glyph badge.
 */
export function Avatar({ friend }: { friend: Friend }): React.JSX.Element {
  const { t } = useTranslation()
  const ring = ringFor(friend)
  const initial = friend.displayName.trim().charAt(0).toUpperCase() || '?'
  const avatarRef = useRef<HTMLSpanElement>(null)
  const dataUrl = useAvatar(friend.avatarUrl, avatarRef)
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null)
  const imageKey = dataUrl ? `${friend.avatarUrl ?? ''}\u0000${dataUrl}` : null

  return (
    <span
      ref={avatarRef}
      role="img"
      aria-label={t(ring.labelKey)}
      className="relative block h-[42px] w-[42px] shrink-0"
    >
      {dataUrl && imageKey !== failedImageKey ? (
        <img
          src={dataUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedImageKey(imageKey)}
          className="h-[42px] w-[42px] rounded-full object-cover"
          style={{ boxShadow: `0 0 0 2.5px var(${ring.colorVar})` }}
        />
      ) : (
        <span
          className="grid h-[42px] w-[42px] place-items-center rounded-full text-sm font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
          style={{ boxShadow: `0 0 0 2.5px var(${ring.colorVar})` }}
        >
          {initial}
        </span>
      )}
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
const FriendRow = memo(function FriendRow({
  friend,
  searchQuery
}: {
  friend: Friend
  searchQuery: string
}): React.JSX.Element {
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
            {splitByMatch(friend.displayName, searchQuery).map((segment, index) =>
              segment.isMatch ? (
                <span
                  key={index}
                  className="bg-[color-mix(in_srgb,var(--text)_16%,transparent)] text-[var(--text)]"
                >
                  {segment.text}
                </span>
              ) : (
                segment.text
              )
            )}
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
        <InstancePill label={instancePill} tier={pillTier} className="min-w-[78px]" />
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  )
})

/** Section header i18n keys (VRX-67) — a lookup map, not template-literal keys,
 *  so the i18n key-existence scan (parity.test.ts) can see them (quoted literals). */
const SECTION_LABEL_KEY: Record<FriendSection, string> = {
  'in-game': 'friends.section.inGame',
  online: 'friends.section.online',
  offline: 'friends.section.offline'
}

/**
 * Chevron glyph for a collapsible section header — rotates -90° when
 * collapsed (§5: a non-color signifier, `aria-expanded` is the real a11y
 * state; this is the visual echo).
 */
function ChevronGlyph({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[14px] w-[14px] shrink-0 motion-safe:transition-transform ${
        collapsed ? '-rotate-90' : ''
      }`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/**
 * Sticky, collapsible presence-section header (VRX-67). A real `<button>` with
 * `aria-expanded` — keyboard accessible for free. Sticks to the top of the
 * existing `<main>` scroll container; the background is opaque enough (a
 * `--bg-base` color-mix, not the translucent `.glass` recipe) that rows don't
 * bleed through as they scroll underneath.
 */
function SectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  collapseIgnored
}: {
  section: FriendSection
  count: number
  collapsed: boolean
  onToggle: () => void
  collapseIgnored: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={collapseIgnored}
      aria-expanded={!collapsed}
      // Only reference the list while it EXISTS — a collapsed section unmounts
      // its <ul> (per AC), and a dangling aria-controls id is an a11y defect
      // (Sol review, Med). aria-expanded alone carries the collapsed state.
      aria-controls={collapsed ? undefined : `friends-section-${section}`}
      className={[
        'sticky top-0 z-10 flex w-full items-center gap-[var(--space-2)]',
        'rounded-control px-[var(--space-2)] py-[var(--space-1)]',
        'bg-[color-mix(in_srgb,var(--bg-base)_92%,transparent)] backdrop-blur-md',
        'text-xs font-semibold tracking-widest text-[var(--text-dim)] uppercase',
        'hover:bg-[var(--surface-hover)] disabled:cursor-default disabled:hover:bg-[color-mix(in_srgb,var(--bg-base)_92%,transparent)] motion-safe:transition-colors'
      ].join(' ')}
    >
      <ChevronGlyph collapsed={collapsed} />
      {t(SECTION_LABEL_KEY[section], { count })}
    </button>
  )
}

export default function FriendsList(): React.JSX.Element {
  const { t } = useTranslation()
  // Server data comes from the TanStack Query cache (VRX-22); the Zustand store
  // holds only view state (search/filter/selection). Both platforms are fetched
  // (cached, shared with the Dashboard/TopBar); the filter selects which to show.
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const search = useFriendsStore((s) => s.search)
  const setSearch = useFriendsStore((s) => s.setSearch)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  const selectedPlatform: Platform | null = platformFilter === 'all' ? null : platformFilter
  const authStatus = useAuthStatus(selectedPlatform ?? 'vrchat')
  const isNotConnected = selectedPlatform !== null && authStatus.data?.state === 'unauthenticated'
  const [appliedSearch, setAppliedSearch] = useState(search)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { friends, isPending, isError, isFetching, refetch } = combineFriendQueries(
    platformFilter,
    useFriends('vrchat'),
    useFriends('chilloutvr')
  )

  // Presence-section grouping (VRX-67): In-Game → Online → Offline, alphabetical
  // within each section — SUPERSEDES the old flat online-first ordering. Counts
  // reflect `friends` (already scoped to the global platform filter above).
  useEffect(() => {
    // Clearing is applied synchronously in updateSearch; no timer is needed.
    if (search.length === 0) return

    const timeout = window.setTimeout(() => setAppliedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName
        const isEditable =
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[contenteditable]:not([contenteditable="false"])') !== null
        if (isEditable) return
      }

      event.preventDefault()
      searchInputRef.current?.focus()
    }

    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const collapsedSections = useSettingsStore((s) => s.settings.collapsedFriendSections)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const searchActive = appliedSearch.length > 0
  const filteredFriends =
    friends === undefined
      ? undefined
      : searchActive
        ? friends.filter((friend) =>
            splitByMatch(friend.displayName, appliedSearch).some((segment) => segment.isMatch)
          )
        : friends
  const sections =
    filteredFriends === undefined ? undefined : groupFriendsBySection(filteredFriends)

  function toggleSection(section: FriendSection): void {
    const next = collapsedSections.includes(section)
      ? collapsedSections.filter((s) => s !== section)
      : [...collapsedSections, section]
    updateSettings({ collapsedFriendSections: next })
  }

  function updateSearch(value: string): void {
    setSearch(value)
    if (value.length === 0) setAppliedSearch('')
  }

  function openAccounts(): void {
    setActiveTab('settings')
    setSettingsCategory('accounts')
  }

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
      <div className="relative mb-[var(--space-3)]">
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(event) => updateSearch(event.target.value)}
          aria-label={t('friends.searchPlaceholder')}
          placeholder={t('friends.searchPlaceholder')}
          className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] py-[var(--space-2)] pr-[var(--space-10)] pl-[var(--space-3)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        />
        {search.length > 0 && (
          <button
            type="button"
            onClick={() => updateSearch('')}
            aria-label={t('friends.clearSearch')}
            className="absolute top-1/2 right-[var(--space-2)] grid h-[24px] w-[24px] -translate-y-1/2 place-items-center rounded-control text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {isNotConnected ? (
        <div className="glass flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-6)] text-center">
          <p className="text-sm font-semibold text-[var(--text-dim)]">
            {t(`friends.notConnected.${selectedPlatform}`)}
          </p>
          <button
            type="button"
            onClick={openAccounts}
            className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
          >
            {t('friends.notConnected.openAccounts')}
          </button>
        </div>
      ) : (
        <>
          {isPending && <p className="text-sm text-[var(--text-faint)]">{t('friends.loading')}</p>}
          {/* Stale-while-revalidate: only surface the error when there's no cached data;
          a background refetch failure keeps showing the last good list. */}
          {isError && !friends && (
            <p className="text-sm text-[var(--error)]">{t('friends.error')}</p>
          )}
          {filteredFriends && filteredFriends.length === 0 && (
            <p className="text-sm text-[var(--text-faint)]">
              {searchActive ? t('friends.searchNoResults') : t('friends.empty')}
            </p>
          )}
          {friends && friends.length > 0 && sections && (
            <div className="flex flex-col gap-[var(--space-2)]">
              {sections.map(({ section, friends: sectionFriends }) => {
                // VRX-65 decision: an active search ignores persisted collapse so
                // every match is visible. The setting itself remains untouched.
                const collapsed = !searchActive && collapsedSections.includes(section)
                return (
                  <div key={section}>
                    <SectionHeader
                      section={section}
                      count={sectionFriends.length}
                      collapsed={collapsed}
                      onToggle={() => {
                        if (!searchActive) toggleSection(section)
                      }}
                      collapseIgnored={searchActive}
                    />
                    {!collapsed && (
                      <ul
                        id={`friends-section-${section}`}
                        // Name the list so SR list navigation identifies WHICH
                        // presence section it is (Sol review, Med) — count included,
                        // same string as the visible header.
                        aria-label={t(SECTION_LABEL_KEY[section], {
                          count: sectionFriends.length
                        })}
                        className="flex flex-col gap-[var(--space-1)] pt-[var(--space-1)]"
                      >
                        {sectionFriends.map((f) => (
                          <FriendRow
                            key={`${f.platform}:${f.platformUserId}`}
                            friend={f}
                            searchQuery={appliedSearch}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}
