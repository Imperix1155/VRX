import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExplorePlatformSnapshot, ExploreRoom, ExploreWorld } from '@shared/explore'
import type { AuthStatus, Platform } from '@shared/types'
import { DEFAULT_EXPLORE_WORLD_TOTAL } from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { requestExplore, useExploreCachedSnapshot, useExploreSnapshot } from '../queries/explore'
import { queryClient } from '../queries/queryClient'
import { authStatusQueryKey } from '../queries/auth'
import { useExploreImage } from '../hooks/useExploreImage'
import { useExploreWorldSelection } from '../hooks/useExploreWorldSelection'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { EXPLORE_SESSION_SEEDS } from '../utils/exploreSeeds'
import ExploreView from './ExploreView'
import ExploreWorldCard from './ExploreWorldCard'
import ExploreWorldSheet from './ExploreWorldSheet'
import ExploreSourceState from './ExploreSourceState'

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
function useCachedAuthStatus(platform: Platform): AuthStatus | undefined {
  return useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryData<AuthStatus>(authStatusQueryKey(platform)),
    () => undefined
  )
}

function ResolvedCard({
  world,
  onOpen
}: {
  world: ExploreWorld
  onOpen: (world: ExploreWorld, opener: HTMLElement) => void
}): React.JSX.Element {
  const { ref, image } = useExploreImage(world.platform, world.worldRef)
  return (
    <div ref={ref} className="h-full w-full">
      <ExploreWorldCard world={world} image={image} onOpen={onOpen} />
    </div>
  )
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
  const vrcAuth = useCachedAuthStatus('vrchat')
  const cvrAuth = useCachedAuthStatus('chilloutvr')
  const vrcSource = sourceSnapshot('vrchat', vrc.data, vrcAuth)
  const cvrSource = sourceSnapshot('chilloutvr', cvr.data, cvrAuth)
  const snapshots = useMemo(
    () =>
      [vrcSource, cvrSource].filter(
        (snapshot): snapshot is NonNullable<typeof snapshot> =>
          snapshot !== undefined &&
          (platformFilter === 'all' || snapshot.platform === platformFilter)
      ),
    [platformFilter, vrcSource, cvrSource]
  )
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

  const refresh = useCallback(() => {
    const platforms =
      platformFilter === 'all' ? (['vrchat', 'chilloutvr'] as const) : ([platformFilter] as const)
    for (const platform of platforms) void requestExplore(platform, 'manual').catch(() => undefined)
  }, [platformFilter])

  const shell = (
    <>
      <div className="mb-[var(--space-3)] flex justify-end">
        <button
          type="button"
          onClick={refresh}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"
        >
          {t('explore.refresh')}
        </button>
      </div>
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
          sheet !== null && joinExploreFailureFor(sheet.world, room) !== null
        }
      />
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
  dismissSignal = 0
}: {
  onSheetOpen?: () => void
  dismissSignal?: number
} = {}): React.JSX.Element | null {
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const vrc = useExploreCachedSnapshot('vrchat')
  const cvr = useExploreCachedSnapshot('chilloutvr')
  const vrcAuth = useCachedAuthStatus('vrchat')
  const cvrAuth = useCachedAuthStatus('chilloutvr')
  const snapshots = [
    sourceSnapshot('vrchat', vrc, vrcAuth),
    sourceSnapshot('chilloutvr', cvr, cvrAuth)
  ].filter(
    (value): value is NonNullable<typeof value> =>
      value !== undefined && (platformFilter === 'all' || value.platform === platformFilter)
  )
  const worlds = selectExploreWorlds({
    lists: {
      vrchat: rankExploreWorlds('vrchat', vrc?.worlds ?? []),
      chilloutvr: rankExploreWorlds('chilloutvr', cvr?.worlds ?? [])
    },
    filter: platformFilter,
    total: 2,
    listSeeds: EXPLORE_SESSION_SEEDS
  })
  const { t } = useTranslation()
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
  if (
    worlds.length === 0 &&
    snapshots.every((source) => source.status === 'ready' || source.status === 'idle')
  )
    return null
  return (
    <section className="mb-[var(--space-6)]" aria-labelledby="dashboard-popular-heading">
      <h2
        id="dashboard-popular-heading"
        className="font-[family-name:var(--font-mono)] text-[20px] font-normal tracking-[0.08em] text-[var(--text-faint)]"
      >
        {t('explore.popularNow')}
      </h2>
      <div className="mt-[var(--space-2)]">
        <ExploreSourceState sources={snapshots} hasUsableCards={worlds.length > 0} />
      </div>
      <div className="mt-[var(--space-3)] grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
        {worlds.map((world) => (
          <ResolvedCard
            key={`${world.platform}:${world.worldId}`}
            world={world}
            onOpen={openWorld}
          />
        ))}
      </div>
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
          sheet !== null && joinExploreFailureFor(sheet.world, room) !== null
        }
        consumeFocusRestoreSuppression={consumeFocusRestoreSuppression}
      />
    </section>
  )
}
