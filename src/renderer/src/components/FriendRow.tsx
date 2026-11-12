import { memo, useCallback, useMemo, useRef } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  RefCallback
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { useSettingsStore } from '../stores/settings'
import type { LinkedRow, ProfileTarget } from '../utils/projectLinkedFriends'
import { StarGlyph } from './FavoriteStar'
import LinkedWorlds from './LinkedWorlds'
import InstancePill from './InstancePill'
import { Avatar } from './Avatar'
import { instancePillFor, type PillTier } from '../utils/instancePill'
import { isWorldHidden } from '../utils/statusRing'
import { splitByMatch } from '../utils/splitByMatch'
import { inPlatformOrder } from '../utils/platformOrder'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'

/**
 * One row of the Friends list: the platform tab, avatar with its status ring,
 * name, world line, instance pill and Join. `FriendsList` owns the virtual
 * list, focus and ordering; this file owns what a single row shows.
 */

/** Height of a compact row. The list's size estimate uses the same number. */
export const COMPACT_FRIEND_ROW_ESTIMATE = 60

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
 * lands the tab 3px off the card's inner left edge (the row has no solid edge
 * bar, owner 2026-11-06); -mt-[5px]/-mb-[5px] bleed through py-[8px] to the
 * same 3px inset top and bottom. PHYSICAL margins only:
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
  const pkey = isVrc ? 'vrc' : 'cvr'
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
      className={`glass-chip grid place-items-center self-stretch -mt-[5px] -mb-[5px] -ml-[7px] w-[calc(100%+7px)] rounded-[9px] border text-[10.5px] font-semibold tracking-[0.09em] [writing-mode:vertical-rl] rotate-180 ${platform === 'vrx' ? 'linked-platform-rail' : ''}`}
      style={{
        background:
          platform === 'vrx'
            ? 'linear-gradient(to top, var(--plat-cvr-rail-bg), var(--plat-vrc-rail-bg))'
            : `var(--plat-${pkey}-rail-bg)`,
        borderColor: platform === 'vrx' ? 'transparent' : `var(--plat-${pkey}-rail-border)`,
        color: platform === 'vrx' ? 'var(--linked-rail-text)' : `var(--plat-${pkey}-rail-text)`
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

/** `text` with the parts the search matched marked. */
function SearchHighlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  return (
    <>
      {splitByMatch(text, query).map((segment, index) =>
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
    </>
  )
}

// The virtual window keeps only a small row set mounted. memo still avoids
// re-rendering an unchanged visible row when unrelated list state changes.
export const FriendRow = memo(function FriendRow({
  rowKey,
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
  offsetY,
  compact,
  favorite,
  measureElement
}: {
  /** The list row's own key; differs from the projection key on a Favorites copy. */
  rowKey: string
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
  /** Primitive position props (not a style object) so the memo comparison holds. */
  offsetY: number
  compact: boolean
  /** Starred in VRX: a small star follows the name. */
  favorite: boolean
  measureElement?: RefCallback<HTMLLIElement>
}): React.JSX.Element {
  const { t } = useTranslation()
  const virtualStyle = useMemo<CSSProperties>(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      transform: `translateY(${offsetY}px)`,
      ...(compact ? { minHeight: COMPACT_FRIEND_ROW_ESTIMATE } : {})
    }),
    [offsetY, compact]
  )
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
  const key = rowKey
  const combined = projection.target.kind === 'person'
  const destinations = projection.accounts.filter(isFriendJoinable)
  const destination = destinations[0]
  const twoLocations = combined && destinations.length === 2
  // Joinable destinations keep their own label; otherwise retain the header's
  // informational pill even when joining is unavailable.
  const pillFriend = combined ? (destination ?? friend) : friend
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
  // Offline friends carry no status (the live offline event clears it; a full
  // roster refresh may still include the old one).
  const customStatus =
    friend.platform === 'vrchat' && friend.presence.state !== 'offline'
      ? (friend.statusDescription ?? null)
      : null

  // Ask Me / DND hide the world entirely (§5 R6); the world is the subline otherwise.
  const hideWorld = isWorldHidden(pillFriend ?? friend)
  // Active/offline friends never expose a stale cached instance (§5 R6), for
  // single-account rows as well as linked ones: VRChat's state comes from the
  // presence buckets while `instance` comes from the raw location.
  const instance = pillFriend.presence.state === 'in-game' ? pillFriend.instance : null
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
  let pillTier: PillTier | null = null
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
  // Its own line under the name and world, starting where they start, with a
  // little air above and below so it never sits on the card's edge. Empty, it
  // takes no room.
  const failureStatus = (
    <span
      role="status"
      className="col-[3/-1] text-[12px] leading-snug break-words text-[var(--text-dim)] [&:not(:empty)]:mt-[var(--space-1)] [&:not(:empty)]:mb-[2px]"
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
  const rowId = `friend-row-${key === projection.key ? '' : 'favorite-'}${friend.platform}-${friend.platformUserId}`

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
          isWorldHidden(account) || account.presence.state !== 'in-game'
            ? null
            : account.instance?.worldId,
          isWorldHidden(account) || account.presence.state !== 'in-game'
            ? null
            : account.instance?.instanceId
        ])
      ])}
      onPointerEnter={() =>
        onRowHover(projection.key.startsWith('person:') ? projection.key : null)
      }
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
        // Platform-tinted capsule, like the Activity rows.
        `platform-row platform-row--${projection.platformMark}`,
        'rounded-[13px] py-[8px] pr-[12px] pl-[10px]',
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
        aria-labelledby={`${rowId}-name ${projection.matchedName ? `${rowId}-match ` : ''}${favorite ? `${rowId}-favorite ` : ''}${rowId}-avatar ${rowId}-world ${rowId}-platform`}
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
            <SearchHighlight
              text={projection.name || t('linking.unknownName')}
              query={searchQuery}
            />
          </span>
          {favorite && (
            <span
              id={`${rowId}-favorite`}
              className="flex shrink-0 self-center text-[var(--favorite)]"
              data-favorite-mark=""
            >
              <StarGlyph on className="h-[12px] w-[12px]" />
              <span className="sr-only">{t('favorites.rowLabel')}</span>
            </span>
          )}
          {/* A linked person found by another of their names shows that name
              here while the search lasts, so the row says why it is listed. */}
          {projection.matchedName ? (
            <span id={`${rowId}-match`} className="min-w-0 truncate text-xs text-[var(--text-dim)]">
              <SearchHighlight text={projection.matchedName} query={searchQuery} />
            </span>
          ) : (
            customStatus && (
              <span className="min-w-0 truncate text-xs text-[var(--text-dim)]">
                {customStatus}
              </span>
            )
          )}
        </div>
        {/* World subline — fixed height keeps every row the same height (§9.1). */}
        <span
          id={`${rowId}-world`}
          className="mt-[1px] block h-[16px] truncate text-[12.5px] leading-[16px] text-[var(--text-dim)]"
        >
          {combined ? (
            <LinkedWorlds accounts={projection.accounts} variant="row" showAccess={twoLocations} />
          ) : (
            worldText
          )}
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
            className="linked-location-button aria-disabled:opacity-50"
            onClick={(event) => {
              if (isJoining) event.stopPropagation()
              else joinFriend(event)
            }}
            aria-disabled={isJoining || undefined}
            tabIndex={isFullyVisible ? undefined : -1}
            // Starts with the pill's own words, like the one-location pill.
            aria-label={t('linking.locationsJoinAria', {
              locations: t('linking.locations', { count: 2 }),
              name: projection.name
            })}
            // The diagonal halves carry each location's access tier in color;
            // the world subline names each one beside its platform tag, and
            // the tooltip spells both out.
            title={inPlatformOrder(destinations)
              .map(
                (account) =>
                  `${t(account.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')}: ${t(instancePillFor(account.instance!, labelScheme).labelKey)}`
              )
              .join(' · ')}
            style={Object.fromEntries(
              destinations.map((account) => [
                `--linked-${account.platform === 'vrchat' ? 'vrc' : 'cvr'}-tier`,
                `var(${instancePillFor(account.instance!, labelScheme).tier ? `--op-${instancePillFor(account.instance!, labelScheme).tier}` : '--text'})`
              ])
            )}
          >
            {t('linking.locations', { count: 2 })}
          </button>
        </span>
      ) : instancePill !== null ? (
        joinable ? (
          <span className="relative block min-w-[78px]" data-join-pill>
            <InstancePill
              label={instancePill}
              tier={pillTier}
              className="min-w-[78px]"
              onJoin={joinFriend}
              disabled={isJoining}
              tabIndex={isFullyVisible ? undefined : -1}
              // Starts with the pill's own words, so the name holds what it shows.
              aria-label={t('friends.joinPillAria', {
                access: instancePill,
                name: combined ? projection.name : friend.displayName,
                world: instance?.worldName ?? t('friends.instance.unknownWorld')
              })}
            />
          </span>
        ) : (
          <InstancePill label={instancePill} tier={pillTier} className="min-w-[78px]" />
        )
      ) : (
        <span aria-hidden="true" />
      )}
      {(joinable || joinFailure) && failureStatus}
    </li>
  )
})
