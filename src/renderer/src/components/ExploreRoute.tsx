import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueryState } from '@tanstack/react-query'
import type { ExplorePlatformSnapshot, ExploreRoom, ExploreWorld } from '@shared/explore'
import type { AuthStatus, Platform } from '@shared/types'
import { DEFAULT_EXPLORE_WORLD_TOTAL } from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { requestExplore, useExploreCachedSnapshot, useExploreSnapshot } from '../queries/explore'
import { queryClient } from '../queries/queryClient'
import { authStatusQueryKey } from '../queries/auth'
import { useExploreWorldSelection } from '../hooks/useExploreWorldSelection'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { isNotConnectedAuth } from '../hooks/useNotConnectedGate'
import { useUiStore } from '../stores/ui'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { EXPLORE_SESSION_SEEDS } from '../utils/exploreSeeds'
import ExploreView from './ExploreView'
import { ResolvedCard } from './WorldResults'
import ExploreListPanel from './ExploreLists'
import SegmentedControl from './SegmentedControl'
import { useRefreshWorldList } from '../queries/community'
import { shownPlatforms } from '../utils/community'
import ExploreWorldSheet from './ExploreWorldSheet'
import { PopularNowSection } from './ExploreDashboardPreview'
import { isPopularNowHidden } from '../utils/popularNow'

function unavailableSnapshot(platform: Platform): ExplorePlatformSnapshot {
  return {
    platform,
    worlds: [],
    status: 'unavailable',
    problem: 'unavailable',
    isStale: false,
    updatedAt: null
  }
}

function sourceSnapshot(
  platform: Platform,
  snapshot: ExplorePlatformSnapshot | undefined,
  auth: AuthStatus | undefined
): ExplorePlatformSnapshot | undefined {
  if (snapshot !== undefined) return snapshot
  return auth?.state === 'unauthenticated' ? unavailableSnapshot(platform) : undefined
}

/** App already owns auth queries. Explore only observes their cache so this
 * display fallback cannot mount or refetch /auth for a disconnected platform. */
function useCachedAuthState(platform: Platform): QueryState<AuthStatus> | undefined {
  return useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryState<AuthStatus>(authStatusQueryKey(platform)),
    () => undefined
  )
}

/** The shared not-connected discriminator (useNotConnectedGate), read from the cache. */
function isNotConnected(state: QueryState<AuthStatus> | undefined): boolean {
  return (
    state !== undefined &&
    isNotConnectedAuth({
      data: state.data,
      isSuccess: state.status === 'success',
      isFetching: state.fetchStatus === 'fetching'
    })
  )
}

/** Under All, a platform the user isn't signed in to adds no source line: that
 * is a choice, not missing data. A single-platform filter shows the Connect gate. */
function shownUnderFilter(
  platformFilter: Platform | 'all',
  snapshot: ExplorePlatformSnapshot | undefined,
  authState: QueryState<AuthStatus> | undefined
): snapshot is ExplorePlatformSnapshot {
  if (snapshot === undefined) return false
  if (platformFilter === 'all') return !isNotConnected(authState)
  return snapshot.platform === platformFilter
}

/** Popular now, then the two lists every platform offers (owner, 2026-10-31). */
const EXPLORE_TABS = ['popular', 'new', 'updated'] as const
type ExploreTab = (typeof EXPLORE_TABS)[number]
const EXPLORE_TAB_KEYS: Record<ExploreTab, string> = {
  popular: 'explore.popularNow',
  new: 'explore.lists.new',
  updated: 'explore.lists.updated'
}

/** Production Explore route. Data fetching is intentionally delegated to AppShell's coordinator. */
export default function ExploreRoute(): React.JSX.Element {
  const { t } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const worldsShown = useSettingsStore(
    (state) => state.settings.exploreWorldsShown ?? DEFAULT_EXPLORE_WORLD_TOTAL
  )
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const vrc = useExploreSnapshot('vrchat')
  const cvr = useExploreSnapshot('chilloutvr')
  const vrcAuth = useCachedAuthState('vrchat')
  const cvrAuth = useCachedAuthState('chilloutvr')
  const setActiveTab = useUiStore((state) => state.setActiveTab)
  const setSettingsCategory = useUiStore((state) => state.setSettingsCategory)
  const vrcSource = sourceSnapshot('vrchat', vrc.data, vrcAuth?.data)
  const cvrSource = sourceSnapshot('chilloutvr', cvr.data, cvrAuth?.data)
  const snapshots = useMemo(
    () =>
      [
        shownUnderFilter(platformFilter, vrcSource, vrcAuth) ? vrcSource : undefined,
        shownUnderFilter(platformFilter, cvrSource, cvrAuth) ? cvrSource : undefined
      ].filter((snapshot) => snapshot !== undefined),
    [platformFilter, vrcSource, cvrSource, vrcAuth, cvrAuth]
  )
  const notConnectedPlatform =
    platformFilter !== 'all' && isNotConnected(platformFilter === 'vrchat' ? vrcAuth : cvrAuth)
      ? platformFilter
      : null
  const worlds = useMemo(() => {
    const lists = {
      vrchat: rankExploreWorlds('vrchat', vrc.data?.worlds ?? []),
      chilloutvr: rankExploreWorlds('chilloutvr', cvr.data?.worlds ?? [])
    }
    return selectExploreWorlds({
      lists,
      filter: platformFilter,
      total: worldsShown,
      listSeeds: EXPLORE_SESSION_SEEDS
    })
  }, [vrc.data?.worlds, cvr.data?.worlds, platformFilter, worldsShown])
  const {
    selected,
    sheet,
    image: sheetImage,
    open: openWorld,
    close: closeSheet,
    refresh: refreshSheet
  } = useExploreWorldSelection(platformFilter)
  const [focusFallback, setFocusFallback] = useState<HTMLDivElement | null>(null)
  const { isJoining, joinExplore, joinExploreFailureFor, pendingConfirm } = useJoinInstance()

  const [tab, setTab] = useState<ExploreTab>('popular')
  const refreshList = useRefreshWorldList()
  const refreshShownList = useCallback(() => {
    if (tab === 'popular') return
    for (const platform of shownPlatforms(platformFilter))
      void refreshList(platform, tab).catch(() => undefined)
  }, [platformFilter, refreshList, tab])
  const refresh = useCallback(() => {
    const platforms =
      platformFilter === 'all' ? (['vrchat', 'chilloutvr'] as const) : ([platformFilter] as const)
    for (const platform of platforms) void requestExplore(platform, 'manual').catch(() => undefined)
  }, [platformFilter])

  if (notConnectedPlatform !== null) {
    // The same Connect gate as the Dashboard and Hot Instances pages.
    return (
      <div className="glass glass-information flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
        <p className="text-sm font-semibold text-[var(--text-dim)]">
          {t(NOT_CONNECTED_KEY.explore[notConnectedPlatform])}
        </p>
        <button
          type="button"
          onClick={() => {
            setActiveTab('settings')
            setSettingsCategory('accounts')
          }}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
        >
          {t('explore.notConnected.openAccounts')}
        </button>
      </div>
    )
  }

  const shell = (
    <>
      <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <SegmentedControl
          values={EXPLORE_TABS}
          active={tab}
          labelKeys={EXPLORE_TAB_KEYS}
          ariaLabel={t('explore.lists.aria')}
          onChange={(next) => {
            // A Popular now sheet belongs to that tab's cards.
            closeSheet()
            setTab(next)
          }}
        />
        <button
          type="button"
          onClick={tab === 'popular' ? refresh : refreshShownList}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"
        >
          {t('explore.refresh')}
        </button>
      </div>
      {tab !== 'popular' ? <ExploreListPanel list={tab} /> : null}
      {tab === 'popular' ? (
        <ExploreView
          worlds={worlds}
          total={worldsShown}
          platformSnapshots={snapshots}
          sheet={sheet}
          sheetOpener={selected?.opener ?? null}
          focusFallback={focusFallback}
          images={sheet && sheetImage ? { [sheet.world.worldRef]: sheetImage } : undefined}
          onTotalChange={(exploreWorldsShown) => updateSettings({ exploreWorldsShown })}
          onOpenWorld={openWorld}
          onCloseSheet={closeSheet}
          onJoinRoom={(room: ExploreRoom) => {
            if (sheet !== null) void joinExplore(sheet.world, room)
          }}
          renderWorld={(world) => (
            <ResolvedCard
              key={`${world.platform}:${world.worldId}`}
              world={world}
              onOpen={openWorld}
            />
          )}
          sheetDismissable={pendingConfirm === null}
          isJoining={isJoining}
          onRefreshSheet={refreshSheet}
          joinFailureFor={(room) =>
            sheet !== null ? joinExploreFailureFor(sheet.world, room) : null
          }
        />
      ) : null}
    </>
  )
  return (
    <div ref={setFocusFallback} tabIndex={-1}>
      {shell}
    </div>
  )
}

/** Dashboard-only shared cache preview. Cards use exactly the same ranking and sheet component. */
export function ExploreDashboardPreviewRoute({
  onSheetOpen,
  dismissSignal = 0,
  cardLayout = 'card',
  onShownChange
}: {
  onSheetOpen?: () => void
  dismissSignal?: number
  /** `bar` when Popular now is the second Dashboard section (owner, 2026-10-18). */
  cardLayout?: 'card' | 'bar'
  /** Told whether the section shows, so the Dashboard can give its space away. */
  onShownChange?: (shown: boolean) => void
} = {}): React.JSX.Element | null {
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const vrc = useExploreCachedSnapshot('vrchat')
  const cvr = useExploreCachedSnapshot('chilloutvr')
  const vrcAuth = useCachedAuthState('vrchat')
  const cvrAuth = useCachedAuthState('chilloutvr')
  const vrcSource = sourceSnapshot('vrchat', vrc, vrcAuth?.data)
  const cvrSource = sourceSnapshot('chilloutvr', cvr, cvrAuth?.data)
  const snapshots = [
    shownUnderFilter(platformFilter, vrcSource, vrcAuth) ? vrcSource : undefined,
    shownUnderFilter(platformFilter, cvrSource, cvrAuth) ? cvrSource : undefined
  ].filter((value) => value !== undefined)
  const worlds = selectExploreWorlds({
    lists: {
      vrchat: rankExploreWorlds('vrchat', vrc?.worlds ?? []),
      chilloutvr: rankExploreWorlds('chilloutvr', cvr?.worlds ?? [])
    },
    filter: platformFilter,
    total: 2,
    listSeeds: EXPLORE_SESSION_SEEDS
  })
  const { isJoining, joinExplore, joinExploreFailureFor, pendingConfirm } = useJoinInstance()
  const {
    selected,
    sheet,
    image,
    open,
    close,
    refresh: refreshSheet
  } = useExploreWorldSelection(platformFilter)
  const lastDismissSignal = useRef(dismissSignal)
  const suppressFocusRestore = useRef(false)
  const consumeFocusRestoreSuppression = useCallback(() => {
    const suppressed = suppressFocusRestore.current
    suppressFocusRestore.current = false
    return suppressed
  }, [])
  const openWorld = useCallback(
    (world: ExploreWorld, opener: HTMLElement) => {
      // An empty preview can unmount the old sheet before it consumes a handoff.
      // Suppression belongs only to that outgoing selection, never this new one.
      suppressFocusRestore.current = false
      onSheetOpen?.()
      open(world, opener)
    },
    [onSheetOpen, open]
  )
  useEffect(() => {
    if (dismissSignal === lastDismissSignal.current) return
    lastDismissSignal.current = dismissSignal
    if (sheet !== null) suppressFocusRestore.current = true
    close()
  }, [close, dismissSignal, sheet])
  const hidden = isPopularNowHidden(worlds, snapshots)
  useEffect(() => {
    onShownChange?.(!hidden)
  }, [hidden, onShownChange])
  if (hidden) return null
  return (
    <PopularNowSection
      platformSnapshots={snapshots}
      hasCards={worlds.length > 0}
      cardLayout={cardLayout}
      cards={worlds.map((world) => (
        <ResolvedCard
          key={`${world.platform}:${world.worldId}`}
          world={world}
          onOpen={openWorld}
          layout={cardLayout}
        />
      ))}
    >
      <ExploreWorldSheet
        snapshot={sheet}
        image={image}
        opener={selected?.opener ?? null}
        focusFallback={typeof document === 'undefined' ? null : document.querySelector('main')}
        onClose={close}
        onRefresh={refreshSheet}
        onJoin={(room) => {
          if (sheet !== null) void joinExplore(sheet.world, room)
        }}
        dismissable={pendingConfirm === null}
        joining={isJoining}
        joinFailureFor={(room) =>
          sheet !== null ? joinExploreFailureFor(sheet.world, room) : null
        }
        consumeFocusRestoreSuppression={consumeFocusRestoreSuppression}
      />
    </PopularNowSection>
  )
}
