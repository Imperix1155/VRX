import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreRoom, ExploreWorld } from '@shared/explore'
import { DEFAULT_EXPLORE_WORLD_TOTAL } from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { requestExplore, useExploreCachedSnapshot, useExploreSnapshot } from '../queries/explore'
import { useExploreImage } from '../hooks/useExploreImage'
import { useExploreWorldSelection } from '../hooks/useExploreWorldSelection'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { EXPLORE_SESSION_SEEDS } from '../utils/exploreSeeds'
import ExploreView from './ExploreView'
import ExploreWorldCard from './ExploreWorldCard'
import ExploreWorldSheet from './ExploreWorldSheet'
import ExploreSourceState from './ExploreSourceState'

function ResolvedCard({
  world,
  onOpen
}: {
  world: ExploreWorld
  onOpen: (world: ExploreWorld, opener: HTMLElement) => void
}): React.JSX.Element {
  const { ref, image } = useExploreImage(world.platform, world.worldRef)
  return (
    <div ref={ref}>
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
  const snapshots = useMemo(
    () =>
      [vrc.data, cvr.data].filter(
        (snapshot): snapshot is NonNullable<typeof snapshot> =>
          snapshot !== undefined &&
          (platformFilter === 'all' || snapshot.platform === platformFilter)
      ),
    [platformFilter, vrc.data, cvr.data]
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
export function ExploreDashboardPreviewRoute(): React.JSX.Element | null {
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const vrc = useExploreCachedSnapshot('vrchat')
  const cvr = useExploreCachedSnapshot('chilloutvr')
  const snapshots = [vrc, cvr].filter(
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
  if (
    worlds.length === 0 &&
    snapshots.every((source) => source.status === 'ready' || source.status === 'idle')
  )
    return null
  return (
    <section className="mb-[var(--space-6)]" aria-labelledby="dashboard-popular-heading">
      <h2
        id="dashboard-popular-heading"
        className="font-[family-name:var(--font-mono)] text-[20px] tracking-[0.08em] text-[var(--text)]"
      >
        {t('explore.popularNow')}
      </h2>
      <div className="mt-[var(--space-2)]">
        <ExploreSourceState sources={snapshots} />
      </div>
      <div className="mt-[var(--space-3)] grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
        {worlds.map((world) => (
          <ResolvedCard key={`${world.platform}:${world.worldId}`} world={world} onOpen={open} />
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
      />
    </section>
  )
}
