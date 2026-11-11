import LinkedProfilesLoadError from './LinkedProfilesLoadError'
import FriendsSourceNotice from './FriendsSourceNotice'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { Range } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FRIEND_LIST_SECTIONS,
  FRIEND_SORTS,
  type Friend,
  type FriendListSection,
  type FriendSort,
  type Platform
} from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
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
import { isFavoriteAccount, useFavoriteFriendKeys } from '../queries/favorites'
import { useGameFavoriteFriendKeys, useGameFavorites } from '../queries/gameFavorites'
import { useProfileSelection } from '../stores/profileSelection'
import { useStableLinkedRows } from '../hooks/useStableLinkedRows'
import LinkedDestinationChooser from './LinkedDestinationChooser'
import FriendDrawer from './FriendDrawer'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { readPixelDesignToken, RENDERER_PIXEL_TOKENS } from '../utils/designTokens'
import { splitFavoritesByGroup } from '../utils/favoriteGroups'
import { latestActivityByFriend, sortFriendRows } from '../utils/friendSort'
import { useActivityForFriendsOrder } from '../queries/activity'
import SegmentedControl from './SegmentedControl'
import { COMPACT_FRIEND_ROW_ESTIMATE, FriendRow } from './FriendRow'
import FriendsSectionHeader from './FriendsSectionHeader'

const INITIAL_VIRTUAL_VIEWPORT = { width: 0, height: 720 }
const SECTION_ROW_ESTIMATE = 32
const FAVORITE_GROUP_ROW_ESTIMATE = 24
const DETAIL_FRIEND_ROW_ESTIMATE = 72
const VIRTUAL_OVERSCAN = 5
const EMPTY_LINKED_ROWS: LinkedRow[] = []
/** A favorite in game shows twice: under Favorites and in its own group. The
 *  Favorites copy gets its own row key so focus, arrows and the virtual list
 *  tell the two apart. */
const FAVORITE_COPY_PREFIX = 'favorite-copy:'

function projectionKeyOf(rowKey: string): string {
  return rowKey.startsWith(FAVORITE_COPY_PREFIX)
    ? rowKey.slice(FAVORITE_COPY_PREFIX.length)
    : rowKey
}

const SORT_LABEL_KEY: Record<FriendSort, string> = {
  name: 'friends.sort.name',
  recent: 'friends.sort.recent',
  world: 'friends.sort.world',
  joinable: 'friends.sort.joinable'
}

function findActiveStickyIndex(
  stickyIndexes: readonly number[],
  startIndex: number
): number | undefined {
  return [...stickyIndexes].reverse().find((index) => startIndex >= index) ?? stickyIndexes[0]
}

function friendRowKey(friend: Friend): string {
  return friend.platform + ':' + friend.platformUserId
}

// Projection keeps an unchanged friend's row object across live updates; keep
// the re-keyed copy just as stable so that friend's memoized row is skipped.
const keyedUnlinkedRows = new WeakMap<LinkedRow, LinkedRow>()

function withFriendRowKey(row: LinkedRow): LinkedRow {
  let keyed = keyedUnlinkedRows.get(row)
  if (keyed === undefined) {
    keyed = { ...row, key: friendRowKey(row.accounts[0]!) }
    keyedUnlinkedRows.set(row, keyed)
  }
  return keyed
}

type VirtualFriendRow =
  | {
      kind: 'section'
      key: `section:${FriendListSection}`
      section: FriendListSection
      count: number
      collapsed: boolean
    }
  | {
      /** A sub-heading inside Favorites: one of the account's favorite groups. */
      kind: 'group'
      key: `group:${string}`
      platform: Platform | null
      name: string | null
      count: number
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
  }, [selectProfile])
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
  const { friends, isPending, isError, isFetching, isLoadingPlaceholder, refetch, sourceFailures } =
    useCombineFriendQueries(platformFilter, vrcFriends, cvrFriends)

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
  // Recent reads the Activity list VRX already keeps; with that page off it
  // keeps nothing, so the choice steps aside and the list orders by name.
  const showActivityPage = useSettingsStore((s) => s.settings.showActivityPage)
  const storedSort = useSettingsStore((s) => s.settings.friendSort)
  const sortChoices = useMemo(
    () => FRIEND_SORTS.filter((sort) => sort !== 'recent' || showActivityPage),
    [showActivityPage]
  )
  const friendSort: FriendSort = sortChoices.includes(storedSort) ? storedSort : 'name'
  const activity = useActivityForFriendsOrder(friendSort === 'recent')
  const latestActivity = useMemo(
    () =>
      friendSort === 'recent' ? latestActivityByFriend(activity.data) : new Map<string, number>(),
    [friendSort, activity.data]
  )
  // One trimmed query drives filtering, highlighting and the section lock, so
  // "alex " still highlights and a spaces-only query doesn't lock sections open.
  const searchQuery = appliedSearch.trim()
  const { filteredFriends, searchActive, personCount } = useMemo(() => {
    const searchActive = searchQuery.length > 0
    const projected = projectLinkedFriends({
      friends: allFriends,
      profiles: links.data?.profiles ?? [],
      accountIds,
      filter: platformFilter,
      search: searchQuery
    })
    const rows = sortFriendRows(
      projected.rows.map((row) => (row.target.personId === null ? withFriendRowKey(row) : row)),
      friendSort,
      { latestActivity }
    )
    const filteredFriends = friends === undefined ? undefined : rows
    return { filteredFriends, searchActive, personCount: projected.personCount }
  }, [
    friends,
    allFriends,
    links.data,
    accountIds,
    platformFilter,
    searchQuery,
    friendSort,
    latestActivity
  ])
  const stableRows = useStableLinkedRows(
    filteredFriends ?? EMPTY_LINKED_ROWS,
    interactionView === viewIdentity ? (focusedLinkedRowKey ?? hoveredRowKey) : null,
    searchQuery
  )
  // Favorites (owner, 2026-11-02, replacing 2026-11-01): the group answers
  // "which of my favorites can I jump in with right now", so it lists only
  // starred friends who are in game. They also stay in In-Game; online and
  // offline favorites stay in their own group. Every starred row carries the
  // star. The group only shows while it has someone in it. A friend in one of
  // the account's own favorite groups counts the same as VRX's star.
  const localFavoriteKeys = useFavoriteFriendKeys()
  const gameFavoriteKeys = useGameFavoriteFriendKeys()
  const favoriteKeys = useMemo(
    () =>
      gameFavoriteKeys.size === 0
        ? localFavoriteKeys
        : new Set([...localFavoriteKeys, ...gameFavoriteKeys]),
    [localFavoriteKeys, gameFavoriteKeys]
  )
  const vrcGameFavorites = useGameFavorites('vrchat').favorites
  const cvrGameFavorites = useGameFavorites('chilloutvr').favorites
  const gameFavorites = useMemo(
    () => ({ vrchat: vrcGameFavorites, chilloutvr: cvrGameFavorites }),
    [vrcGameFavorites, cvrGameFavorites]
  )
  const sections = useMemo(() => {
    if (filteredFriends === undefined) return undefined
    return FRIEND_LIST_SECTIONS.map((section) => ({
      section,
      friends:
        section === 'favorites'
          ? stableRows.filter(
              (row) => row.section === 'in-game' && isFavoriteAccount(favoriteKeys, row.accounts)
            )
          : stableRows.filter((row) => row.section === section)
    })).filter(({ section, friends }) => section !== 'favorites' || friends.length > 0)
  }, [filteredFriends, stableRows, favoriteKeys])

  // One flattened stream lets a single virtualizer own headers and friend rows.
  // Keeping headers in the same index space is what makes a section-aware sticky
  // range possible without adding a second scroll container inside <main>.
  const profileById = useMemo(
    () => new Map((links.data?.profiles ?? []).map((profile) => [profile.id, profile])),
    [links.data]
  )
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
        const pushFriend = (projection: LinkedRow): void => {
          // Hand the resolver only this row's profile: a full-array scan per row
          // made preparation O(rows × profiles) on every live update.
          const profile = profileById.get(projection.target.personId ?? '')
          const friend =
            resolveLinkedProfile(projection.target, {
              friends: projection.accounts,
              profiles: profile === undefined ? [] : [profile],
              accountIds
            })?.header ??
            projection.accounts[0] ??
            null
          rows.push({
            kind: 'friend',
            key: section === 'favorites' ? FAVORITE_COPY_PREFIX + projection.key : projection.key,
            friend,
            projection
          })
        }
        // Favorites split by the account's own favorite groups, each under a
        // small sub-heading. With fewer than two parts there is nothing to
        // tell apart, so the section stays one plain list.
        const parts =
          section === 'favorites' ? splitFavoritesByGroup(sectionFriends, gameFavorites) : []
        if (parts.length === 0) sectionFriends.forEach(pushFriend)
        for (const part of parts) {
          rows.push({
            kind: 'group',
            key: `group:${part.key}`,
            platform: part.platform,
            name: part.name,
            count: part.rows.length
          })
          part.rows.forEach(pushFriend)
        }
      }
    }
    return rows
  }, [sections, searchActive, collapsedSections, profileById, accountIds, gameFavorites])

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
  const sectionButtonElementsRef = useRef(new Map<FriendListSection, HTMLButtonElement>())
  const pendingFocusKeyRef = useRef<string | null>(null)
  const focusedRowKeyRef = useRef<string | null>(null)
  const focusedPersonRef = useRef<string | null>(null)
  const [rovingKey, setRovingKey] = useState<string | null>(null)
  const [focusedSection, setFocusedSection] = useState<FriendListSection | null>(null)
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
      if (virtualRows[index]?.kind === 'group') return FAVORITE_GROUP_ROW_ESTIMATE
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
    (section: FriendListSection, element: HTMLButtonElement | null): void => {
      if (element === null) sectionButtonElementsRef.current.delete(section)
      else sectionButtonElementsRef.current.set(section, element)
    },
    []
  )
  const onRovingFocus = useCallback((key: string): void => {
    setRovingKey(key)
  }, [])
  // Row callbacks read the current rows through this ref so their identity
  // survives live updates; a new callback would re-render every mounted row.
  const latestRowsRef = useRef({
    stableRows,
    friendKeys,
    friendPositionByKey,
    friendVirtualIndexByKey
  })
  useLayoutEffect(() => {
    latestRowsRef.current = { stableRows, friendKeys, friendPositionByKey, friendVirtualIndexByKey }
  }, [stableRows, friendKeys, friendPositionByKey, friendVirtualIndexByKey])
  const onRowFocus = useCallback((key: string): void => {
    focusedRowKeyRef.current = key
    const projectionKey = projectionKeyOf(key)
    setFocusedLinkedRowKey(projectionKey.startsWith('person:') ? projectionKey : null)
    focusedPersonRef.current =
      latestRowsRef.current.stableRows.find(
        (row) => row.key === projectionKey && row.target.personId !== null
      )?.personKey ?? null
    // Join is a separate native control after the avatar in each row. If Tab
    // reaches it, that row must also own the roving avatar stop so a live
    // update that removes Join can hand focus back to the connected avatar.
    setRovingKey(key)
  }, [])
  const onRowBlur = useCallback((key: string): void => {
    if (focusedRowKeyRef.current === key) focusedRowKeyRef.current = null
    const projectionKey = projectionKeyOf(key)
    setFocusedLinkedRowKey((current) => (current === projectionKey ? null : current))
  }, [])
  const onSectionFocus = useCallback((section: FriendListSection): void => {
    setFocusedSection(section)
  }, [])
  const onSectionBlur = useCallback((section: FriendListSection): void => {
    setFocusedSection((current) => (current === section ? null : current))
  }, [])
  const onArrowNavigate = useCallback(
    (key: string, direction: -1 | 1): void => {
      const { friendKeys, friendPositionByKey, friendVirtualIndexByKey } = latestRowsRef.current
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
    [rowVirtualizer]
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

  // Look up in the UNFILTERED list of both platforms, so neither an active
  // search nor the platform filter closes an open drawer. A friend that leaves
  // the roster closes it.
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

  function toggleSection(section: FriendListSection): void {
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
      className="glass-panel rounded-panel border border-[var(--glass-border)] p-[var(--space-4)]"
    >
      <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        {/* Names the section for assistive tech; the top bar already shows the
            page's one visible "Friends" heading (DESIGN.md §8). */}
        <h2 id="friends-list-heading" className="sr-only">
          {t('friends.title')}
        </h2>
        {/* Order inside each group (owner, 2026-11-02): the same control as
            the platform picker, on the left above Search friends. */}
        <div className="mr-auto">
          <SegmentedControl
            values={sortChoices}
            active={friendSort}
            labelKeys={SORT_LABEL_KEY}
            ariaLabel={t('friends.sort.aria')}
            onChange={(value) => updateSettings({ friendSort: value })}
          />
        </div>
        {links.data?.profiles.length ? (
          <span data-testid="linked-person-count" className="text-xs text-[var(--text-dim)]">
            {t('linking.people', { count: personCount })}
          </span>
        ) : null}
        <button
          type="button"
          // aria-disabled keeps keyboard focus here through a refresh.
          onClick={() => {
            if (!isFetching) void refetch()
          }}
          aria-disabled={isFetching || undefined}
          aria-label={t('friends.refresh')}
          className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] aria-disabled:opacity-50 motion-safe:transition-colors"
        >
          {t('friends.refresh')}
        </button>
      </div>
      <LinkedProfilesLoadError query={links} />
      {!isAuthStatusPending && !isNotConnected ? (
        <FriendsSourceNotice failures={sourceFailures} />
      ) : null}
      <div className="relative mb-[var(--space-3)]">
        <input
          ref={searchInputRef}
          id="friends-search"
          type="text"
          value={search}
          onChange={(event) => updateSearch(event.target.value)}
          aria-label={t('friends.searchPlaceholder')}
          placeholder={t('friends.searchPlaceholder')}
          className="glass-layer w-full rounded-control border border-[var(--border)] py-[var(--space-2)] pr-[var(--space-10)] pl-[var(--space-3)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--glass-layer),var(--text)_8%)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        />
        {search.length > 0 && (
          <button
            type="button"
            onClick={() => {
              updateSearch('')
              // The button goes away with the search; keep focus in the field.
              searchInputRef.current?.focus()
            }}
            aria-label={t('friends.clearSearch')}
            className="absolute top-1/2 right-[var(--space-2)] grid h-[24px] w-[24px] -translate-y-1/2 place-items-center rounded-control text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {isAuthStatusPending ? (
        <p className="text-sm text-[var(--text-dim)]">{t('friends.loading')}</p>
      ) : isNotConnected ? (
        <div className="glass glass-layer flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-6)] text-center">
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
          {isPending && <p className="text-sm text-[var(--text-dim)]">{t('friends.loading')}</p>}
          {/* Stale-while-revalidate: only surface the error when there's no cached data;
          a background refetch failure keeps showing the last good list. */}
          {/* A platform-named source notice replaces the generic error when another
          platform did load (issue 368). */}
          {isError && !friends && sourceFailures.length === 0 && (
            <p className="text-sm text-[var(--error)]">{t('friends.error')}</p>
          )}
          {/* The [] placeholder a sign-in or account switch leaves says loading
          while the new roster loads; a verified empty roster that is merely
          refreshing keeps saying there are no friends yet. */}
          {filteredFriends && filteredFriends.length === 0 && (
            <p className="text-sm text-[var(--text-dim)]">
              {searchActive
                ? t('friends.searchNoResults')
                : isLoadingPlaceholder
                  ? t('friends.loading')
                  : t('friends.empty')}
            </p>
          )}
          {/* Empty filtered results show only the line above, never three
          zero-count section headers under it. */}
          {friends && friends.length > 0 && sections && filteredFriends?.length !== 0 && (
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
                      // Pin at <main>'s top edge, not inside its top padding,
                      // so no strip of scrolled rows shows above the header.
                      top: 'calc(-1 * var(--space-2))',
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
                      <FriendsSectionHeader
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

                if (row.kind === 'group') {
                  const count = row.count
                  return (
                    <li
                      key={virtualItem.key}
                      ref={rowVirtualizer.measureElement}
                      role="presentation"
                      data-index={virtualItem.index}
                      data-virtual-kind="group"
                      style={virtualStyle}
                      className="list-none"
                    >
                      {/* Plain words, never a chip: the name the user gave the
                          group, the platform it lives on, and how many are here. */}
                      <p
                        data-favorite-group={row.key}
                        className="truncate px-[var(--space-2)] pt-[var(--space-1)] text-[11.5px] font-semibold leading-[18px] text-[var(--text-dim)]"
                      >
                        {row.name === null || row.platform === null
                          ? t('friends.favoriteGroup.vrx', { count })
                          : t('friends.favoriteGroup.game', {
                              name: row.name,
                              platform: t(
                                row.platform === 'vrchat'
                                  ? 'friends.platform.vrchatShort'
                                  : 'friends.platform.chilloutvrShort'
                              ),
                              count
                            })}
                      </p>
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
                      style={{ ...virtualStyle, minHeight: COMPACT_FRIEND_ROW_ESTIMATE }}
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
                    rowKey={row.key}
                    friend={row.friend}
                    projection={row.projection}
                    linkedProfile={links.data?.profiles.find(
                      (profile) => profile.id === row.projection.target.personId
                    )}
                    accountIds={accountIds}
                    onChoose={setChooserTarget}
                    onRowHover={setHoveredRowKey}
                    searchQuery={searchQuery}
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
                    offsetY={virtualItem.start - scrollMargin}
                    compact={density === 'compact'}
                    favorite={isFavoriteAccount(favoriteKeys, row.projection.accounts)}
                    measureElement={rowVirtualizer.measureElement}
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
