import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, FriendSection } from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import { isFriendJoinable } from '@shared/joinability'
import { useFriends, combineFriendQueries } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { groupFriendsBySection } from '../utils/groupFriendsBySection'
import InstancePill from './InstancePill'
import FriendDrawer from './FriendDrawer'
import { Avatar } from './Avatar'
import { OPENNESS_TIER, type OpennessTier } from '../utils/instancePill'
import { isWorldHidden } from '../utils/statusRing'
import { splitByMatch } from '../utils/splitByMatch'
import { useJoinInstance } from '../hooks/useJoinInstance'

// ─── Status ring (DESIGN.md §9.1) ─────────────────────────────────────────────
// The avatar's status-color ring + badge REPLACE the old presence-dot + status-
// pill (§5/R6/R10 carve-out): the ring carries the hue and the avatar's
// aria-label exposes the status TEXT (so status is never color-only) — the
// drawer's written status band is the long-form signifier (VRX-69; the badge's
// svg glyph was retired the same round). The two §5 axes stay distinct — STATUS
// drives the ring; PRESENCE (in a world or not) drives the world subline.
// Ring model + fold live in `utils/statusRing.ts`, shared with FriendDrawer.

/**
 * Platform tab — the row's platform signal, color AND non-color (VRX-206; owner-
 * approved design round 2026-07-11, reversing the §9.1 R10 color-only carve-out).
 * A vertical platform-tinted pill stacked onto the card's left end per the stack
 * model: even 3px inset on the attached sides, radius concentric with the card
 * (13px card − 1px border − 3px gap = 9px), sideways VRC/CVR acronym so the
 * platform survives the §5 black-and-white test.
 *
 * Geometry couples to the row's frame: grid col 14px + row pl-[10px] → -ml-[7px]
 * lands the tab 3px off the card's inner left edge; -mt-[5px]/-mb-[5px] bleed
 * through py-[8px] to the same 3px inset top and bottom. PHYSICAL margins only:
 * -my-* emits logical margin-block, which [writing-mode:vertical-rl] rotates onto
 * the HORIZONTAL axis (review-caught High) — same trap for any future -m*.
 */
function PlatformTab({ platform }: { platform: Friend['platform'] }): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = platform === 'vrchat'
  const pvar = isVrc ? '--vrc' : '--cvr'
  return (
    <span
      role="img"
      aria-label={isVrc ? t('friends.platform.vrchat') : t('friends.platform.chilloutvr')}
      className="grid place-items-center self-stretch -mt-[5px] -mb-[5px] -ml-[7px] w-[calc(100%+7px)] rounded-[9px] border text-[10.5px] font-semibold tracking-[0.09em] [writing-mode:vertical-rl] rotate-180"
      style={{
        background: `color-mix(in srgb, var(${pvar}) 13%, transparent)`,
        borderColor: `color-mix(in srgb, var(${pvar}) 36%, transparent)`,
        color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)'
      }}
    >
      {isVrc ? t('friends.platform.vrchatShort') : t('friends.platform.chilloutvrShort')}
    </span>
  )
}

// Avatar moved to components/Avatar.tsx (VRX-69) — shared with FriendDrawer
// without a FriendsList ⇄ FriendDrawer import cycle.

// memo: the query cache's structuralSharing keeps unchanged Friend object
// references across refetches, so memoizing the row skips re-rendering every
// unchanged friend on each reconcile tick (audit W5 stopgap; virtualization is
// the real fix and lands with VRX-64).
const FriendRow = memo(function FriendRow({
  friend,
  searchQuery,
  onOpen
}: {
  friend: Friend
  searchQuery: string
  /** Open the friend drawer (VRX-69). Stable callback so the memo holds. */
  onOpen: (friend: Friend, opener: HTMLElement) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Store subscription (not a prop) so memo'd rows still re-render on change.
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  // Shared join flow (VRX-166; one implementation with the drawer — VRX-69).
  const { isJoining, joinFailed, join } = useJoinInstance()

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
  // and, when shared joinability passes, the §9.1 join button (VRX-166).
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
  const joinable = isFriendJoinable(friend)

  function joinFriend(event: React.MouseEvent<HTMLButtonElement>): void {
    // The pill is an inner button — never let its click open the drawer.
    event.stopPropagation()
    void join(friend)
  }

  // Ids for the opener's composed accessible name (aria-labelledby below).
  const rowId = `friend-row-${friend.platform}-${friend.platformUserId}`

  return (
    <li
      className={[
        // grid: 14px platform tab · 42px avatar · 1fr content · auto instance pill
        'relative grid grid-cols-[14px_42px_1fr_auto] items-center gap-x-[12px]',
        'rounded-[13px] py-[8px] pr-[12px] pl-[10px]',
        'border border-[color-mix(in_srgb,var(--text)_7%,transparent)]',
        'bg-[color-mix(in_srgb,var(--text)_4%,transparent)]',
        'hover:bg-[var(--surface-hover)] motion-safe:transition-colors'
      ].join(' ')}
    >
      {/* Details opener (VRX-69 review restructure): the li stays purely
          structural (listitem semantics intact — no interactive role nesting
          the Join button), and this stretched native <button> carries the
          click/keyboard/focus behavior. Its accessible name COMPOSES from the
          visible name + status (the avatar's aria-label) + world via
          aria-labelledby, so screen readers lose nothing (§9.1 non-color
          contract). Absolutely positioned → not a grid item; the Join pill
          stacks ABOVE it (z-[1]) and stays independently clickable. */}
      <button
        type="button"
        onClick={(event) => onOpen(friend, event.currentTarget)}
        aria-labelledby={`${rowId}-name ${rowId}-avatar ${rowId}-world`}
        className="absolute inset-0 z-0 cursor-pointer rounded-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
      />
      <PlatformTab platform={friend.platform} />
      <span id={`${rowId}-avatar`}>
        <Avatar friend={friend} />
      </span>

      {/* Content — name + custom status (beside), world beneath */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-[8px]">
          <span
            id={`${rowId}-name`}
            className="max-w-[68%] shrink-0 truncate text-sm font-semibold text-[var(--text)]"
          >
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
        <span
          id={`${rowId}-world`}
          className="mt-[1px] block h-[16px] truncate text-[12.5px] leading-[16px] text-[var(--text-dim)]"
        >
          {worldText}
        </span>
      </div>

      {/* Instance pill — same width column, centered (§9.1); tier-colored per the §6
          openness ladder (inline style: tier→token is runtime lookup, so Tailwind
          can't emit it). Neutral (Private / CVR Offline Instance) pills stay hueless
          but readable. Joinable friends receive the button variant (VRX-166). */}
      {instancePill != null ? (
        joinable ? (
          <span className="relative z-[1] block min-w-[78px]">
            <InstancePill
              label={instancePill}
              tier={pillTier}
              className="min-w-[78px]"
              onJoin={joinFriend}
              disabled={isJoining}
              aria-label={t('friends.joinAria', {
                name: friend.displayName,
                world: instance?.worldName ?? instancePill
              })}
            />
            <span
              role="status"
              className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-[var(--space-1)] text-[12px] text-[var(--text-dim)]"
            >
              {joinFailed ? t('friends.joinFailed') : ''}
            </span>
          </span>
        ) : (
          <InstancePill label={instancePill} tier={pillTier} className="min-w-[78px]" />
        )
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
  // Drawer selection (VRX-69) — the store's existing view-state slot. The id is
  // the composite row key (platform:platformUserId) so the two platforms can
  // never collide. The opener element is remembered so focus RETURNS to the row
  // on close (dialog a11y contract).
  const selectedFriendId = useFriendsStore((s) => s.selectedFriendId)
  const setSelectedFriendId = useFriendsStore((s) => s.setSelectedFriendId)
  const openerRef = useRef<HTMLElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const openDrawer = useCallback(
    (friend: Friend, opener: HTMLElement) => {
      openerRef.current = opener
      setSelectedFriendId(`${friend.platform}:${friend.platformUserId}`)
    },
    [setSelectedFriendId]
  )
  // The ONE close path for EVERY way the drawer shuts (Esc / scrim / ✕ /
  // stale-selection cleanup). Focus returns to the opener row only if it is
  // still in the document; otherwise it falls back to the search input so
  // focus never silently drops to <body> (VRX-69 review).
  const closeDrawer = useCallback(() => {
    setSelectedFriendId(null)
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus()
    else searchInputRef.current?.focus()
  }, [setSelectedFriendId])
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const [appliedSearch, setAppliedSearch] = useState(search)
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
      // Never steal focus out of the open friend drawer (VRX-69: the dialog's
      // focus trap owns the keyboard while it's open).
      if (useFriendsStore.getState().selectedFriendId !== null) return
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
  // Look up in the UNFILTERED (but platform-scoped) list so an active search
  // can't close an open drawer. A friend that leaves the roster closes it.
  const selectedFriend =
    selectedFriendId === null
      ? null
      : (friends?.find((f) => `${f.platform}:${f.platformUserId}` === selectedFriendId) ?? null)

  // A selection whose friend has LEFT the settled roster is stale — close the
  // drawer (through the one close path, so focus lands somewhere sane), or it
  // would pop back open uninvited if the friend ever returned (e.g. platform
  // reconnect). Loading states keep the selection (friends undefined ≠ gone).
  useEffect(() => {
    if (selectedFriendId !== null && friends !== undefined) {
      const stillPresent = friends.some(
        (f) => `${f.platform}:${f.platformUserId}` === selectedFriendId
      )
      if (!stillPresent) closeDrawer()
    }
  }, [friends, selectedFriendId, closeDrawer])

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
      {isAuthStatusPending ? (
        <p className="text-sm text-[var(--text-faint)]">{t('friends.loading')}</p>
      ) : isNotConnected ? (
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
                            onOpen={openDrawer}
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
      <FriendDrawer friend={selectedFriend} onClose={closeDrawer} />
    </section>
  )
}
