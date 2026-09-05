import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { Range } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  RefCallback
} from 'react'
import { useTranslation } from 'react-i18next'
import { FRIEND_SECTIONS, type Friend, type FriendSection, type Platform } from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import { isFriendJoinable } from '@shared/joinability'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { useFriends, useCombineFriendQueries } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import {
  projectLinkedFriends,
  resolveLinkedProfile,
  type LinkedRow,
  type ProfileTarget
} from '../utils/projectLinkedFriends'
import { useLinkedProfiles } from '../queries/linkedProfiles'
import { useProfileSelection } from '../stores/profileSelection'
import { useStableLinkedRows } from '../hooks/useStableLinkedRows'
import LinkedWorlds from './LinkedWorlds'
import LinkedDestinationChooser from './LinkedDestinationChooser'
import InstancePill from './InstancePill'
import FriendDrawer from './FriendDrawer'
import { Avatar } from './Avatar'
import { instancePillFor, type OpennessTier } from '../utils/instancePill'
import { isWorldHidden } from '../utils/statusRing'
import { splitByMatch } from '../utils/splitByMatch'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { readPixelDesignToken, RENDERER_PIXEL_TOKENS } from '../utils/designTokens'

const INITIAL_VIRTUAL_VIEWPORT = { width: 0, height: 720 }
const SECTION_ROW_ESTIMATE = 32
const COMPACT_FRIEND_ROW_ESTIMATE = 60
const DETAIL_FRIEND_ROW_ESTIMATE = 72
const VIRTUAL_OVERSCAN = 5
const EMPTY_LINKED_ROWS: LinkedRow[] = []

function findActiveStickyIndex(
  stickyIndexes: readonly number[],
  startIndex: number
): number | undefined {
  return [...stickyIndexes].reverse().find((index) => startIndex >= index) ?? stickyIndexes[0]
}

function friendRowKey(friend: Friend): string {
  return friend.platform + ':' + friend.platformUserId
}

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
function PlatformTab({
  platform,
  labelId
}: {
  platform: Friend['platform'] | 'vrx'
  /** Stable per-row id so the row's details opener can compose the platform
   *  into its accessible name via aria-labelledby (VRX-69 re-review). */
  labelId?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = platform === 'vrchat'
  const pvar = isVrc ? '--vrc' : '--cvr'
  return (
    <span
      id={labelId}
      role="img"
      aria-label={
        platform === 'vrx'
          ? 'VRX'
          : isVrc
            ? t('friends.platform.vrchat')
            : t('friends.platform.chilloutvr')
      }
      className={`grid place-items-center self-stretch -mt-[5px] -mb-[5px] -ml-[7px] w-[calc(100%+7px)] rounded-[9px] border text-[10.5px] font-semibold tracking-[0.09em] [writing-mode:vertical-rl] rotate-180 ${platform === 'vrx' ? 'linked-platform-rail' : ''}`}
      style={{
        background:
          platform === 'vrx'
            ? 'linear-gradient(to top, color-mix(in srgb, var(--cvr) 13%, transparent), color-mix(in srgb, var(--vrc) 13%, transparent))'
            : `color-mix(in srgb, var(${pvar}) 13%, transparent)`,
        borderColor:
          platform === 'vrx' ? 'transparent' : `color-mix(in srgb, var(${pvar}) 36%, transparent)`,
        color:
          platform === 'vrx'
            ? 'var(--text)'
            : isVrc
              ? 'var(--plat-vrc-ghost-text)'
              : 'var(--plat-cvr-ghost-text)'
      }}
    >
      {platform === 'vrx' ? (
        <span className="linked-gradient-text">VRX</span>
      ) : isVrc ? (
        t('friends.platform.vrchatShort')
      ) : (
        t('friends.platform.chilloutvrShort')
      )}
    </span>
  )
}

// Avatar moved to components/Avatar.tsx (VRX-69) — shared with FriendDrawer
// without a FriendsList ⇄ FriendDrawer import cycle.

// The virtual window keeps only a small row set mounted. memo still avoids
// re-rendering an unchanged visible row when unrelated list state changes.
const FriendRow = memo(function FriendRow({
  friend,
  projection,
  linkedProfile,
  accountIds,
  onChoose,
  onRowHover,
  searchQuery,
  onOpen,
  isRovingStop,
  isFullyVisible,
  positionInSet,
  setSize,
  onRovingFocus,
  onRowFocus,
  onRowBlur,
  onArrowNavigate,
  setAvatarElement,
  virtualIndex,
  virtualStyle,
  measureElement
}: {
  friend: Friend
  projection: LinkedRow
  linkedProfile: LinkedProfile | undefined
  accountIds: Partial<Record<Platform, string>>
  onChoose: (target: ProfileTarget) => void
  onRowHover: (key: string | null) => void
  searchQuery: string
  /** Open the friend drawer (VRX-69). Stable callback so the memo holds. */
  onOpen: (friend: Friend, opener: HTMLElement, target: ProfileTarget) => void
  isRovingStop: boolean
  isFullyVisible: boolean
  positionInSet: number
  setSize: number
  onRovingFocus: (key: string) => void
  onRowFocus: (key: string) => void
  onRowBlur: (key: string) => void
  onArrowNavigate: (key: string, direction: -1 | 1) => void
  setAvatarElement: (key: string, element: HTMLButtonElement | null) => void
  virtualIndex: number
  virtualStyle: CSSProperties
  measureElement?: RefCallback<HTMLLIElement>
}): React.JSX.Element {
  const { t } = useTranslation()
  // Store subscription (not a prop) so memo'd rows still re-render on change.
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  // Drawer opener surface (VRX-228): 'card' (default) = the whole row is a
  // POINTER opener; 'avatar' = the VRX-225 avatar-only behavior.
  const drawerOpener = useSettingsStore((s) => s.settings.drawerOpener)
  const cardOpens = drawerOpener === 'card'
  // The avatar button element — the SEMANTIC opener in both modes. Card-mode
  // row clicks delegate to the same open path with THIS element as the opener
  // so focus return still lands on the avatar (VRX-228 contract).
  const avatarButtonRef = useRef<HTMLButtonElement>(null)
  const key = projection.key
  const combined = projection.target.kind === 'person'
  const destinations = projection.accounts.filter(isFriendJoinable)
  const destination = destinations[0]
  const twoLocations = combined && destinations.length === 2
  const pillFriend = combined ? destination : friend
  const setAvatarButton = useCallback(
    (element: HTMLButtonElement | null) => {
      avatarButtonRef.current = element
      setAvatarElement(key, element)
    },
    [key, setAvatarElement]
  )
  // Shared join flow (VRX-166; one implementation with the drawer — VRX-69).
  const { isJoining, joinFailureFor, join } = useJoinInstance()

  // Custom status — VRChat only; sits BESIDE the name for every status (§9.1).
  const customStatus = friend.platform === 'vrchat' ? (friend.statusDescription ?? null) : null

  // Ask Me / DND hide the world entirely (§5 R6); the world is the subline otherwise.
  const hideWorld = isWorldHidden(pillFriend ?? friend)
  const instance = pillFriend?.instance ?? null
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
    const resolved = instancePillFor(instance, labelScheme)
    instancePill = t(resolved.labelKey)
    pillTier = resolved.tier
  } else if (friend.presence.state === 'in-game') {
    instancePill = t('friends.instance.private')
  }
  const joinable = combined ? destinations.length > 0 : isFriendJoinable(friend)
  const joinFailure =
    combined && linkedProfile
      ? linkedProfile.members
          .filter((member) => accountIds[member.platform] === member.platformAccountId)
          .map((member) =>
            joinFailureFor({ platform: member.platform, platformUserId: member.friendId })
          )
          .find((reason) => reason !== null)
      : joinFailureFor(friend)
  const failureStatus = (
    <span
      role="status"
      className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-[var(--space-1)] text-[12px] text-[var(--text-dim)]"
      style={
        combined && joinFailure ? { background: 'var(--bg-base)', borderRadius: 10 } : undefined
      }
    >
      {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
    </span>
  )

  function joinFriend(event: MouseEvent<HTMLButtonElement>): void {
    // Containment is BACK (VRX-228): VRX-225 removed stopPropagation because the
    // avatar-only opener left nothing beneath the pill — the whole-card opener
    // puts a click target under it again. Belt-and-suspenders with the li's
    // `closest('[data-join-pill]')` guard below: join wins over open, always.
    event.stopPropagation()
    if (combined) onChoose(projection.target)
    else void join(friend)
  }

  // Whole-card POINTER opener (VRX-228, owner ruling 2026-07-27 — knowingly
  // supersedes the VRX-225 avatar-only ruling for pointer input). The li stays
  // a plain listitem — NEVER a role, NEVER a tab stop (the VRX-69 role-
  // flattening finding): the avatar button remains the semantic/keyboard
  // opener; this handler only widens the pointer target onto the same path.
  function openFromRow(event: MouseEvent<HTMLLIElement>): void {
    const target = event.target
    if (!(target instanceof Element)) return
    // Join-pill containment: the pill is an independent sibling control and
    // join wins over open. Don't rely on the pill's own stopPropagation alone
    // (VRX-225 removed it once precisely because nothing sat under the pill —
    // that premise changed again, so the robust guard lives HERE too).
    if (target.closest('[data-join-pill]') !== null) return
    // Selection-drag guard: a plain click collapses the document selection on
    // mousedown (before click fires); after a drag-select across row text it
    // is still non-collapsed at click time — that mouseup must NOT open.
    // Scope to selections INTERSECTING this row: a stale non-collapsed
    // selection elsewhere (e.g. drawer note text selected earlier) must not
    // turn a plain row click into a dead click.
    const selection = window.getSelection()
    if (
      selection !== null &&
      !selection.isCollapsed &&
      selection.rangeCount > 0 &&
      // intersectsNode over commonAncestorContainer.contains: it also covers
      // ranges that START inside the row and extend beyond it (the common
      // ancestor would sit ABOVE the li and the contains check would miss).
      selection.getRangeAt(0).intersectsNode(event.currentTarget)
    )
      return
    const opener = avatarButtonRef.current
    if (opener !== null) onOpen(friend, opener, projection.target)
  }

  function navigateFromAvatar(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    onArrowNavigate(key, event.key === 'ArrowDown' ? 1 : -1)
  }

  // Ids for the opener's composed accessible name (aria-labelledby below).
  const rowId = `friend-row-${friend.platform}-${friend.platformUserId}`

  return (
    <li
      ref={measureElement}
      data-index={virtualIndex}
      data-virtual-kind="friend"
      data-friend-key={key}
      data-person-key={projection.personKey}
      data-gesture-key={JSON.stringify([
        projection.target,
        projection.accounts.map((account) => [
          account.platform,
          account.platformUserId,
          account.presence.state,
          account.status,
          isWorldHidden(account) ? null : account.instance?.worldId,
          isWorldHidden(account) ? null : account.instance?.instanceId
        ])
      ])}
      onPointerEnter={() => onRowHover(key.startsWith('person:') ? key : null)}
      onPointerLeave={() => onRowHover(null)}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      onFocusCapture={() => onRowFocus(key)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        onRowBlur(key)
      }}
      style={virtualStyle}
      {...(cardOpens
        ? {
            // VRX-228 card mode: the card surface joins the drawer's
            // outside-close exemption so clicking ANOTHER friend's card
            // SWITCHES the open drawer in place (the owner-praised behavior)
            // instead of outside-close firing first. Avatar mode leaves the
            // exemption on the avatar button alone (VRX-225, byte-preserved).
            'data-drawer-opener': true,
            onClick: openFromRow
          }
        : {})}
      className={[
        // grid: 14px platform tab · 42px avatar · 1fr content · auto instance pill
        'grid grid-cols-[14px_42px_1fr_auto] items-center gap-x-[12px]',
        'rounded-[13px] py-[8px] pr-[12px] pl-[10px]',
        'border border-[color-mix(in_srgb,var(--text)_7%,transparent)]',
        'bg-[color-mix(in_srgb,var(--text)_4%,transparent)]',
        'hover:bg-[var(--surface-hover)] motion-safe:transition-colors',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--text-dim)]',
        'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-transparent',
        cardOpens ? 'cursor-pointer' : ''
      ].join(' ')}
    >
      <PlatformTab platform={projection.platformMark} labelId={`${rowId}-platform`} />
      {/* Details opener = the AVATAR button (VRX-225, owner decision — the old
          stretched whole-row opener made every stray click open the drawer).
          Still a native <button>, still the row's keyboard stop (Enter/Space),
          and its accessible name still COMPOSES name + status (the avatar's
          aria-label) + world + platform via aria-labelledby, so screen readers
          lose nothing (§9.1 non-color contract). `data-drawer-opener` exempts
          it from the drawer's outside-close listener: clicking another
          friend's avatar SWITCHES the open card instead of closing it.
          (↻ VRX-228, owner ruling 2026-07-27: in the default 'card' mode the
          WHOLE ROW is an additional POINTER-only opener delegating to this
          same path — the li above carries the handler/exemption; this button
          stays the semantic/keyboard opener and focus-return target.) */}
      <button
        ref={setAvatarButton}
        type="button"
        id={`${rowId}-avatar`}
        data-drawer-opener
        onClick={(event) => onOpen(friend, event.currentTarget, projection.target)}
        onFocus={() => onRovingFocus(key)}
        onKeyDown={navigateFromAvatar}
        tabIndex={isRovingStop ? 0 : -1}
        aria-labelledby={`${rowId}-name ${rowId}-avatar ${rowId}-world ${rowId}-platform`}
        className="cursor-pointer rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] focus:ring-offset-2 focus:ring-offset-transparent"
      >
        <Avatar
          friend={friend}
          mergedWith={
            combined && linkedProfile?.pictureMode === 'merged'
              ? projection.accounts.find((account) => account.platform !== friend.platform)
              : undefined
          }
        />
      </button>

      {/* Content — name + custom status (beside), world beneath */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-[8px]">
          <span
            id={`${rowId}-name`}
            className="max-w-[68%] shrink-0 truncate text-sm font-semibold text-[var(--text)]"
          >
            {splitByMatch(projection.name || t('linking.unknownName'), searchQuery).map(
              (segment, index) =>
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
          {combined ? <LinkedWorlds accounts={projection.accounts} variant="row" /> : worldText}
        </span>
      </div>

      {/* Instance pill — same width column, centered (§9.1); tier-colored per the §6
          openness ladder (inline style: tier→token is runtime lookup, so Tailwind
          can't emit it). Neutral (Private / CVR Offline Instance) pills stay hueless
          but readable. Joinable friends receive the button variant (VRX-166). */}
      {twoLocations ? (
        <span className="relative block" data-join-pill>
          <button
            type="button"
            data-join-pill
            className="linked-location-button disabled:opacity-50"
            onClick={joinFriend}
            disabled={isJoining}
            tabIndex={isFullyVisible ? undefined : -1}
            style={Object.fromEntries(
              destinations.map((account) => [
                `--linked-${account.platform === 'vrchat' ? 'vrc' : 'cvr'}-tier`,
                `var(${instancePillFor(account.instance!, labelScheme).tier ? `--op-${instancePillFor(account.instance!, labelScheme).tier}` : '--text'})`
              ])
            )}
          >
            {t('linking.locations', { count: 2 })}
          </button>
          {failureStatus}
        </span>
      ) : instancePill !== null && (!combined || joinable) ? (
        joinable ? (
          <span className="relative block min-w-[78px]" data-join-pill>
            <InstancePill
              label={instancePill}
              tier={pillTier}
              className="min-w-[78px]"
              onJoin={joinFriend}
              disabled={isJoining}
              tabIndex={isFullyVisible ? undefined : -1}
              aria-label={t('friends.joinAria', {
                name: combined ? projection.name : friend.displayName,
                world: instance?.worldName ?? instancePill
              })}
            />
            {failureStatus}
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
 * Collapsible presence-section header (VRX-67). A real `<button>` with
 * `aria-expanded` — keyboard accessible for free. The virtual-row wrapper owns
 * sticky positioning so the active header remains mounted outside its natural
 * range; this button keeps the opaque background that prevents row bleed.
 */
function SectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  collapseIgnored,
  tabIndex,
  setButtonElement,
  onFocus,
  onBlur
}: {
  section: FriendSection
  count: number
  collapsed: boolean
  onToggle: () => void
  collapseIgnored: boolean
  tabIndex: 0 | -1
  setButtonElement: (section: FriendSection, element: HTMLButtonElement | null) => void
  onFocus: (section: FriendSection) => void
  onBlur: (section: FriendSection) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      ref={(element) => setButtonElement(section, element)}
      type="button"
      onClick={onToggle}
      onFocus={() => onFocus(section)}
      onBlur={() => onBlur(section)}
      disabled={collapseIgnored}
      tabIndex={collapseIgnored ? -1 : tabIndex}
      aria-expanded={!collapsed}
      // All sections share one virtual list, so no header claims that whole
      // list as its controlled object. aria-expanded carries disclosure state.
      className={[
        'flex w-full items-center gap-[var(--space-2)]',
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

type VirtualFriendRow =
  | {
      kind: 'section'
      key: `section:${FriendSection}`
      section: FriendSection
      count: number
      collapsed: boolean
    }
  | {
      kind: 'friend'
      key: string
      friend: Friend | null
      projection: LinkedRow
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
  const target = useProfileSelection((s) => s.target)
  const selectProfile = useProfileSelection((s) => s.select)
  const [chooserTarget, setChooserTarget] = useState<ProfileTarget | null>(null)
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null)
  const [focusedLinkedRowKey, setFocusedLinkedRowKey] = useState<string | null>(null)
  const viewIdentity = platformFilter + '\u0000' + search
  const [interactionView, setInteractionView] = useState(viewIdentity)
  if (interactionView !== viewIdentity) {
    setInteractionView(viewIdentity)
    setHoveredRowKey(null)
    setFocusedLinkedRowKey(null)
  }
  const pointerIntent = useRef<string | null>(null)
  // VRX-210: the modal join dialog suppresses the `/` search shortcut.
  const { pendingConfirm } = useJoinInstance()
  const openerRef = useRef<HTMLElement | null>(null)
  const openerIdentityRef = useRef<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const openDrawer = useCallback(
    (_friend: Friend, opener: HTMLElement, target: ProfileTarget) => {
      openerRef.current = opener
      const ref = target.kind === 'person' ? target.anchor : target.account
      openerIdentityRef.current =
        target.personId === null ? `${ref.platform}:${ref.friendId}` : `person:${target.personId}`
      selectProfile(target)
    },
    [selectProfile]
  )
  // The ONE close path for EVERY way the drawer shuts (Esc / scrim / ✕ /
  // stale-selection cleanup). Focus returns to the opener row only if it is
  // still in the document; otherwise it falls back to the search input so
  // focus never silently drops to <body> (VRX-69 review).
  const closeDrawer = useCallback(() => {
    selectProfile(null)
    const opener = openerRef.current
    openerRef.current = null
    // preventScroll (Codex review, VRX-225): the non-modal list can be freely
    // scrolled while the card is open, so a plain .focus() on a now-offscreen
    // opener would yank the list back to it on close — the exact jump this
    // change exists to kill. Keyboard users regain a visible focus point on
    // their next Tab/arrow, which scrolls normally.
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    else {
      const identity = openerIdentityRef.current
      const replacement =
        identity === null
          ? undefined
          : [...avatarElementsRef.current].find(
              ([key]) => key === identity || key.startsWith(identity + ':')
            )?.[1]
      if (replacement?.isConnected) replacement.focus({ preventScroll: true })
      else searchInputRef.current?.focus({ preventScroll: true })
    }
    openerIdentityRef.current = null
  }, [selectProfile])
  useEffect(() => {
    const remove = window.vrx?.onIdentityBoundary?.(() => {
      // A null intent means keyboard/no preceding pointer and permits a click.
      // Keep a mismatching tombstone until a fresh gesture starts instead.
      pointerIntent.current = 'identity-boundary-invalidated'
      setChooserTarget(null)
      setHoveredRowKey(null)
      setFocusedLinkedRowKey(null)
      openerRef.current = null
      openerIdentityRef.current = null
      selectProfile(null)
      searchInputRef.current?.focus({ preventScroll: true })
    })
    return () => {
      remove?.()
      selectProfile(null)
    }
  }, [closeDrawer, selectProfile])
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const notConnectedKey =
    selectedPlatform === null ? null : NOT_CONNECTED_KEY.friends[selectedPlatform]
  const [appliedSearch, setAppliedSearch] = useState(search)
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')
  const links = useLinkedProfiles()
  const accountIds = useMemo(() => links.data?.accountIds ?? {}, [links.data])
  const allFriends = useMemo(
    () => [...(vrcFriends.data ?? []), ...(cvrFriends.data ?? [])],
    [vrcFriends.data, cvrFriends.data]
  )
  const { friends, isPending, isError, isFetching, refetch } = useCombineFriendQueries(
    platformFilter,
    vrcFriends,
    cvrFriends
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
      // The join confirmation dialog (VRX-210) IS modal — `/` must not yank
      // focus out from under it. (The NON-modal drawer needs no such
      // suppression; its old one served the retired focus trap.)
      if (pendingConfirm !== null) return
      // The drawer is NON-MODAL since VRX-225 — the list (and its shortcuts)
      // stay live while the card is open, so `/` works everywhere except
      // inside editable controls (the guard below covers the notes textarea).
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
  }, [pendingConfirm])

  const collapsedSections = useSettingsStore((s) => s.settings.collapsedFriendSections)
  const density = useSettingsStore((s) => s.settings.density)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const { filteredFriends, searchActive, personCount } = useMemo(() => {
    const searchActive = appliedSearch.length > 0
    const projected = projectLinkedFriends({
      friends: allFriends,
      profiles: links.data?.profiles ?? [],
      accountIds,
      filter: platformFilter,
      search: appliedSearch
    })
    const rows = projected.rows.map((row) =>
      row.target.personId === null ? { ...row, key: friendRowKey(row.accounts[0]!) } : row
    )
    const filteredFriends = friends === undefined ? undefined : rows
    return { filteredFriends, searchActive, personCount: projected.personCount }
  }, [friends, allFriends, links.data, accountIds, platformFilter, appliedSearch])
  const stableRows = useStableLinkedRows(
    filteredFriends ?? EMPTY_LINKED_ROWS,
    interactionView === viewIdentity ? (focusedLinkedRowKey ?? hoveredRowKey) : null
  )
  const sections = useMemo(
    () =>
      filteredFriends === undefined
        ? undefined
        : FRIEND_SECTIONS.map((section) => ({
            section,
            friends: stableRows.filter((row) => row.section === section)
          })),
    [filteredFriends, stableRows]
  )

  // One flattened stream lets a single virtualizer own headers and friend rows.
  // Keeping headers in the same index space is what makes a section-aware sticky
  // range possible without adding a second scroll container inside <main>.
  const virtualRows = useMemo(() => {
    const rows: VirtualFriendRow[] = []
    if (sections === undefined) return rows

    for (const { section, friends: sectionFriends } of sections) {
      const collapsed = !searchActive && collapsedSections.includes(section)
      rows.push({
        kind: 'section',
        key: `section:${section}`,
        section,
        count: sectionFriends.length,
        collapsed
      })
      if (!collapsed) {
        for (const projection of sectionFriends) {
          const friend =
            resolveLinkedProfile(projection.target, {
              friends: projection.accounts,
              profiles: links.data?.profiles ?? [],
              accountIds
            })?.header ??
            projection.accounts[0] ??
            null
          rows.push({ kind: 'friend', key: projection.key, friend, projection })
        }
      }
    }
    return rows
  }, [sections, searchActive, collapsedSections, links.data, accountIds])

  const friendKeys = useMemo(
    () => virtualRows.flatMap((row) => (row.kind === 'friend' ? [row.key] : [])),
    [virtualRows]
  )
  const friendPositionByKey = useMemo(
    () => new Map(friendKeys.map((key, index) => [key, index])),
    [friendKeys]
  )
  const friendVirtualIndexByKey = useMemo(() => {
    const indexes = new Map<string, number>()
    virtualRows.forEach((row, index) => {
      if (row.kind === 'friend') indexes.set(row.key, index)
    })
    return indexes
  }, [virtualRows])
  const stickyIndexes = useMemo(
    () => virtualRows.flatMap((row, index) => (row.kind === 'section' ? [index] : [])),
    [virtualRows]
  )

  const virtualListRef = useRef<HTMLUListElement>(null)
  const avatarElementsRef = useRef(new Map<string, HTMLButtonElement>())
  const sectionButtonElementsRef = useRef(new Map<FriendSection, HTMLButtonElement>())
  const pendingFocusKeyRef = useRef<string | null>(null)
  const focusedRowKeyRef = useRef<string | null>(null)
  const focusedPersonRef = useRef<string | null>(null)
  const [rovingKey, setRovingKey] = useState<string | null>(null)
  const [focusedSection, setFocusedSection] = useState<FriendSection | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [virtualRowGap, setVirtualRowGap] = useState<number>(
    RENDERER_PIXEL_TOKENS.space1.fallbackPx
  )
  const focusedSectionIndex =
    focusedSection === null
      ? null
      : (stickyIndexes.find((index) => {
          const row = virtualRows[index]
          return row?.kind === 'section' && row.section === focusedSection
        }) ?? null)
  const effectiveRovingKey =
    rovingKey !== null && friendPositionByKey.has(rovingKey) ? rovingKey : (friendKeys[0] ?? null)

  const getScrollElement = useCallback((): HTMLElement | null => {
    const element = virtualListRef.current?.closest('main')
    return element instanceof HTMLElement ? element : null
  }, [])
  useLayoutEffect(() => {
    const tokenGap = readPixelDesignToken(RENDERER_PIXEL_TOKENS.space1)
    setVirtualRowGap((current) => (current === tokenGap ? current : tokenGap))
  }, [])
  const getItemKey = useCallback(
    (index: number) => {
      const row = virtualRows[index]
      return row === undefined ? index : density + ':' + row.key
    },
    [density, virtualRows]
  )
  const estimateSize = useCallback(
    (index: number) => {
      if (virtualRows[index]?.kind === 'section') return SECTION_ROW_ESTIMATE
      return density === 'compact' ? COMPACT_FRIEND_ROW_ESTIMATE : DETAIL_FRIEND_ROW_ESTIMATE
    },
    [density, virtualRows]
  )
  const rangeExtractor = useCallback(
    (range: Range) => {
      const activeStickyIndex = findActiveStickyIndex(stickyIndexes, range.startIndex)

      const indexes = new Set(defaultRangeExtractor(range))
      if (activeStickyIndex !== undefined) indexes.add(activeStickyIndex)
      if (focusedSectionIndex !== null) indexes.add(focusedSectionIndex)
      return [...indexes].sort((a, b) => a - b)
    },
    [focusedSectionIndex, stickyIndexes]
  )

  // TanStack Virtual intentionally exposes a mutable instance; React Compiler
  // must leave this component's hook result unmemoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: virtualRows.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    rangeExtractor,
    gap: virtualRowGap,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin,
    scrollPaddingStart: SECTION_ROW_ESTIMATE + virtualRowGap,
    initialRect: INITIAL_VIRTUAL_VIEWPORT
  })

  // This list intentionally shares AppShell's one <main> scroller. Tell the
  // virtualizer where the list begins within that larger scroll surface, and
  // keep the offset current if the header/search geometry changes.
  useLayoutEffect(() => {
    const list = virtualListRef.current
    const scrollElement = getScrollElement()
    if (list === null || scrollElement === null) return

    const measureMargin = (): void => {
      const next = Math.max(
        0,
        list.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop
      )
      setScrollMargin((current) => (current === next ? current : next))
    }

    measureMargin()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureMargin)
    observer?.observe(scrollElement)
    if (list.parentElement !== null) observer?.observe(list.parentElement)
    observer?.observe(list)
    window.addEventListener('resize', measureMargin)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measureMargin)
    }
  }, [getScrollElement, virtualRows.length])

  const setAvatarElement = useCallback((key: string, element: HTMLButtonElement | null): void => {
    if (element === null) avatarElementsRef.current.delete(key)
    else avatarElementsRef.current.set(key, element)
  }, [])
  const setSectionButtonElement = useCallback(
    (section: FriendSection, element: HTMLButtonElement | null): void => {
      if (element === null) sectionButtonElementsRef.current.delete(section)
      else sectionButtonElementsRef.current.set(section, element)
    },
    []
  )
  const onRovingFocus = useCallback((key: string): void => {
    setRovingKey(key)
  }, [])
  const onRowFocus = useCallback(
    (key: string): void => {
      focusedRowKeyRef.current = key
      setFocusedLinkedRowKey(key.startsWith('person:') ? key : null)
      focusedPersonRef.current =
        stableRows.find((row) => row.key === key && row.target.personId !== null)?.personKey ?? null
      // Join is a separate native control after the avatar in each row. If Tab
      // reaches it, that row must also own the roving avatar stop so a live
      // update that removes Join can hand focus back to the connected avatar.
      setRovingKey(key)
    },
    [stableRows]
  )
  const onRowBlur = useCallback((key: string): void => {
    if (focusedRowKeyRef.current === key) focusedRowKeyRef.current = null
    setFocusedLinkedRowKey((current) => (current === key ? null : current))
  }, [])
  const onSectionFocus = useCallback((section: FriendSection): void => {
    setFocusedSection(section)
  }, [])
  const onSectionBlur = useCallback((section: FriendSection): void => {
    setFocusedSection((current) => (current === section ? null : current))
  }, [])
  const onArrowNavigate = useCallback(
    (key: string, direction: -1 | 1): void => {
      const currentPosition = friendPositionByKey.get(key)
      if (currentPosition === undefined) return
      const targetPosition = Math.min(
        friendKeys.length - 1,
        Math.max(0, currentPosition + direction)
      )
      const targetKey = friendKeys[targetPosition]
      if (targetKey === undefined || targetKey === key) return
      const virtualIndex = friendVirtualIndexByKey.get(targetKey)
      if (virtualIndex === undefined) return

      pendingFocusKeyRef.current = targetKey
      setRovingKey(targetKey)
      // `auto` preserves the current viewport when the next opener is already
      // visible, and performs the smallest necessary scroll at a window edge.
      rowVirtualizer.scrollToIndex(virtualIndex, { align: 'auto' })
    },
    [friendPositionByKey, friendKeys, friendVirtualIndexByKey, rowVirtualizer]
  )

  // Arrow navigation may target the next row just outside the current window.
  // Leave the pending key armed until the virtualizer mounts that opener, then
  // focus without asking the browser to perform a second, competing scroll.
  useEffect(() => {
    const pendingKey = pendingFocusKeyRef.current
    if (pendingKey === null) return
    if (!friendPositionByKey.has(pendingKey)) {
      pendingFocusKeyRef.current = null
      return
    }
    const element = avatarElementsRef.current.get(pendingKey)
    if (element?.isConnected !== true) return
    pendingFocusKeyRef.current = null
    element.focus({ preventScroll: true })
  })

  // A wheel, touch gesture, or scrollbar interaction supersedes an arrow-key
  // target that has not mounted yet. Without clearing it, focus recovery
  // mistakes the stale target for an active navigation request after the user
  // scrolls the focused row out of the virtual window.
  useEffect(() => {
    const scrollElement = getScrollElement()
    if (scrollElement === null) return
    const cancelPendingFocus = (): void => {
      pendingFocusKeyRef.current = null
    }
    const cancelPendingFocusOnScrollKey = (event: globalThis.KeyboardEvent): void => {
      if (['PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) cancelPendingFocus()
    }
    scrollElement.addEventListener('wheel', cancelPendingFocus, { passive: true })
    scrollElement.addEventListener('touchmove', cancelPendingFocus, { passive: true })
    scrollElement.addEventListener('pointerdown', cancelPendingFocus)
    scrollElement.addEventListener('keydown', cancelPendingFocusOnScrollKey)
    return () => {
      scrollElement.removeEventListener('wheel', cancelPendingFocus)
      scrollElement.removeEventListener('touchmove', cancelPendingFocus)
      scrollElement.removeEventListener('pointerdown', cancelPendingFocus)
      scrollElement.removeEventListener('keydown', cancelPendingFocusOnScrollKey)
    }
  }, [getScrollElement, virtualRows.length])

  // Look up in the UNFILTERED (but platform-scoped) list so an active search
  // can't close an open drawer. A friend that leaves the roster closes it.
  const selectedProfile = resolveLinkedProfile(target, {
    friends: allFriends,
    profiles: links.data?.profiles ?? [],
    accountIds
  })
  const selectedFriend = selectedProfile?.header ?? null
  const chooserProfile = resolveLinkedProfile(chooserTarget, {
    friends: allFriends,
    profiles: links.data?.profiles ?? [],
    accountIds
  })

  // A selection whose friend is no longer renderable — gone from the settled
  // roster OR the roster itself went undefined (refetch gap, account switch) —
  // must close through the ONE close path (Codex re-review: the render alone
  // passes null to the drawer, stranding focus on the inert ✕, keeping "/"
  // disabled, and reopening the drawer uninvited when data returns).
  useEffect(() => {
    if (target !== null && selectedFriend === null) closeDrawer()
  }, [selectedFriend, target, closeDrawer])

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

  const virtualItems = rowVirtualizer.getVirtualItems()
  const activeStickyIndex =
    findActiveStickyIndex(stickyIndexes, rowVirtualizer.range?.startIndex ?? 0) ?? 0
  const renderedFriendKeys = new Set(
    virtualItems.flatMap((item) => {
      const row = virtualRows[item.index]
      return row?.kind === 'friend' ? [row.key] : []
    })
  )
  const viewportStart = (rowVirtualizer.scrollOffset ?? 0) + SECTION_ROW_ESTIMATE + virtualRowGap
  const viewportEnd =
    (rowVirtualizer.scrollOffset ?? 0) +
    (rowVirtualizer.scrollRect?.height ?? INITIAL_VIRTUAL_VIEWPORT.height)
  const fullyVisibleFriendKeys: string[] = []
  const intersectingFriendKeys: string[] = []
  const focusableSectionIndexSet = new Set<number>()
  for (const item of virtualItems) {
    const row = virtualRows[item.index]
    if (row?.kind === 'section') {
      if (
        item.index === activeStickyIndex ||
        (item.end > viewportStart && item.start < viewportEnd)
      ) {
        focusableSectionIndexSet.add(item.index)
      }
      continue
    }
    if (row?.kind !== 'friend') continue
    if (item.end > viewportStart && item.start < viewportEnd) {
      intersectingFriendKeys.push(row.key)
    }
    if (item.start >= viewportStart && item.end <= viewportEnd) {
      fullyVisibleFriendKeys.push(row.key)
    }
  }
  const fullyVisibleFriendKeySet = new Set(fullyVisibleFriendKeys)
  const intersectingFriendKeySet = new Set(intersectingFriendKeys)
  // Overscan rows are mounted but can sit hundreds of pixels outside the
  // viewport. Preserve a focused/intersecting opener until its row leaves the
  // viewport, then hand the one Tab stop to a fully visible friend.
  const renderedRovingKey =
    effectiveRovingKey !== null && intersectingFriendKeySet.has(effectiveRovingKey)
      ? effectiveRovingKey
      : (fullyVisibleFriendKeys[0] ??
        intersectingFriendKeys[0] ??
        renderedFriendKeys.values().next().value ??
        null)
  const activeStickyRow = virtualRows[activeStickyIndex]
  const activeStickySection = activeStickyRow?.kind === 'section' ? activeStickyRow.section : null
  const focusedSectionNeedsHandoff =
    focusedSection !== null &&
    (focusedSectionIndex === null || !focusableSectionIndexSet.has(focusedSectionIndex))

  // Overscanned section toggles are not sequential Tab stops. If pointer or
  // scrollbar scrolling carries a focused header out of view, its retained
  // virtual row hands focus to the newly active sticky header before it can be
  // unmounted and strand focus on <body>.
  useLayoutEffect(() => {
    if (!focusedSectionNeedsHandoff) return
    const target =
      activeStickySection === null
        ? undefined
        : sectionButtonElementsRef.current.get(activeStickySection)
    if (target !== undefined) {
      target.focus({ preventScroll: true })
      return
    }
    setFocusedSection(null)
    searchInputRef.current?.focus({ preventScroll: true })
  }, [activeStickySection, focusedSectionNeedsHandoff])

  // A scrollbar drag, wheel, or PageDown can unmount the focused avatar. The
  // browser then falls back to <body>, so move real focus along with the
  // roving Tab stop. Arrow navigation owns its pending target separately.
  useLayoutEffect(() => {
    const pendingKey = pendingFocusKeyRef.current
    if (pendingKey !== null) {
      if (friendPositionByKey.has(pendingKey)) return
      pendingFocusKeyRef.current = null
    }

    const focusedKey = focusedRowKeyRef.current
    if (focusedKey === null) return
    const replacementAvatar = avatarElementsRef.current.get(focusedKey)
    const focusedRowWasRemoved =
      document.activeElement === document.body && replacementAvatar?.isConnected !== true
    const focusedRowWasReplaced =
      focusedKey === renderedRovingKey &&
      document.activeElement === document.body &&
      replacementAvatar?.isConnected === true
    if (!focusedRowWasRemoved && !focusedRowWasReplaced) return

    if (focusedPersonRef.current !== null && focusedRowWasRemoved) {
      const samePerson = virtualRows.find(
        (row) => row.kind === 'friend' && row.projection.personKey === focusedPersonRef.current
      )
      const avatar = samePerson ? avatarElementsRef.current.get(samePerson.key) : undefined
      focusedRowKeyRef.current = null
      setFocusedLinkedRowKey(null)
      if (avatar?.isConnected) avatar.focus({ preventScroll: true })
      else searchInputRef.current?.focus({ preventScroll: true })
      return
    }

    if (renderedRovingKey === null) {
      focusedRowKeyRef.current = null
      searchInputRef.current?.focus({ preventScroll: true })
      return
    }
    avatarElementsRef.current.get(renderedRovingKey)?.focus({ preventScroll: true })
  }, [density, friendPositionByKey, renderedRovingKey, virtualRows])

  return (
    <section
      aria-labelledby="friends-list-heading"
      onPointerDownCapture={(event) => {
        pointerIntent.current =
          event.target instanceof Element
            ? (event.target.closest('[data-friend-key]')?.getAttribute('data-gesture-key') ?? null)
            : null
      }}
      onPointerCancelCapture={() => {
        pointerIntent.current = null
      }}
      onKeyDownCapture={() => {
        pointerIntent.current = null
      }}
      onClickCapture={(event) => {
        const reviewed = pointerIntent.current
        pointerIntent.current = null
        if (reviewed === null) return
        const current =
          event.target instanceof Element
            ? event.target.closest('[data-friend-key]')?.getAttribute('data-gesture-key')
            : null
        if (current !== reviewed) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      className="rounded-panel border border-[var(--border)] p-[var(--space-4)]"
    >
      <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-2)]">
        <h2
          id="friends-list-heading"
          className="font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase"
        >
          {t('friends.title')}
        </h2>
        {links.data?.profiles.length ? (
          <span data-testid="linked-person-count" className="text-xs text-[var(--text-dim)]">
            {t('linking.people', { count: personCount })}
          </span>
        ) : null}
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
          id="friends-search"
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
            {notConnectedKey === null ? null : t(notConnectedKey)}
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
            <ul
              ref={virtualListRef}
              id="friends-virtual-list"
              aria-label={t('friends.title')}
              className="relative m-0 list-none p-0"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {virtualItems.map((virtualItem) => {
                const row = virtualRows[virtualItem.index]
                if (row === undefined) return null
                const activeSticky =
                  row.kind === 'section' && virtualItem.index === activeStickyIndex
                const virtualStyle: CSSProperties = activeSticky
                  ? {
                      position: 'sticky',
                      top: 0,
                      left: 0,
                      width: '100%',
                      zIndex: 10
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start - scrollMargin}px)`
                    }

                if (row.kind === 'section') {
                  return (
                    <li
                      key={virtualItem.key}
                      ref={rowVirtualizer.measureElement}
                      role="presentation"
                      data-index={virtualItem.index}
                      data-virtual-kind="section"
                      style={virtualStyle}
                      className="list-none"
                    >
                      <SectionHeader
                        section={row.section}
                        count={row.count}
                        collapsed={row.collapsed}
                        onToggle={() => {
                          if (!searchActive) toggleSection(row.section)
                        }}
                        collapseIgnored={searchActive}
                        tabIndex={focusableSectionIndexSet.has(virtualItem.index) ? 0 : -1}
                        setButtonElement={setSectionButtonElement}
                        onFocus={onSectionFocus}
                        onBlur={onSectionBlur}
                      />
                    </li>
                  )
                }

                const positionInSet = friendPositionByKey.get(row.key)
                if (positionInSet === undefined) return null
                if (row.friend === null)
                  return (
                    <li
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      data-virtual-kind="friend"
                      data-friend-key={row.key}
                      style={{ ...virtualStyle, height: COMPACT_FRIEND_ROW_ESTIMATE }}
                      className="rounded-control border border-[var(--border)] px-[var(--space-3)] text-[var(--text-dim)]"
                      onPointerLeave={() => setHoveredRowKey(null)}
                    >
                      <button
                        type="button"
                        aria-disabled="true"
                        ref={(element) => setAvatarElement(row.key, element)}
                        onFocus={() => onRowFocus(row.key)}
                        onBlur={() => onRowBlur(row.key)}
                      >
                        {t('linking.unavailable')}
                      </button>
                    </li>
                  )

                return (
                  <FriendRow
                    key={virtualItem.key}
                    friend={row.friend}
                    projection={row.projection}
                    linkedProfile={links.data?.profiles.find(
                      (profile) => profile.id === row.projection.target.personId
                    )}
                    accountIds={accountIds}
                    onChoose={setChooserTarget}
                    onRowHover={setHoveredRowKey}
                    searchQuery={appliedSearch}
                    onOpen={openDrawer}
                    isRovingStop={row.key === renderedRovingKey}
                    isFullyVisible={fullyVisibleFriendKeySet.has(row.key)}
                    positionInSet={positionInSet + 1}
                    setSize={friendKeys.length}
                    onRovingFocus={onRovingFocus}
                    onRowFocus={onRowFocus}
                    onRowBlur={onRowBlur}
                    onArrowNavigate={onArrowNavigate}
                    setAvatarElement={setAvatarElement}
                    virtualIndex={virtualItem.index}
                    virtualStyle={
                      density === 'compact'
                        ? { ...virtualStyle, height: COMPACT_FRIEND_ROW_ESTIMATE }
                        : virtualStyle
                    }
                    measureElement={
                      density === 'compact' ? undefined : rowVirtualizer.measureElement
                    }
                  />
                )
              })}
            </ul>
          )}
        </>
      )}
      <FriendDrawer
        friend={selectedFriend}
        selection={selectedProfile}
        friends={allFriends}
        accountIds={accountIds}
        available={{
          vrchat: !vrcFriends.isError && vrcFriends.data !== undefined,
          chilloutvr: !cvrFriends.isError && cvrFriends.data !== undefined
        }}
        onNavigate={selectProfile}
        onClose={closeDrawer}
      />
      {chooserTarget && (
        <LinkedDestinationChooser
          accounts={chooserProfile?.accounts ?? []}
          onClose={() => setChooserTarget(null)}
        />
      )}
    </section>
  )
}
