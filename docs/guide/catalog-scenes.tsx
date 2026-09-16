import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import type { LabelScheme, Platform } from '@shared/types'
import { Avatar } from '@renderer/components/Avatar'
import DashboardView from '@renderer/components/DashboardView'
import ExploreDashboardPreview from '@renderer/components/ExploreDashboardPreview'
import ExploreView from '@renderer/components/ExploreView'
import ExploreWorldCard from '@renderer/components/ExploreWorldCard'
import ExploreWorldSheet from '@renderer/components/ExploreWorldSheet'
import InstancePill from '@renderer/components/InstancePill'
import PolicySpacePill from '@renderer/components/PolicySpacePill'
import SegmentedControl from '@renderer/components/SegmentedControl'
import TopBar from '@renderer/components/TopBar'
import { instancePillFor } from '@renderer/utils/instancePill'
import {
  friends,
  getPlatformSnapshot,
  getWorldSnapshot,
  instanceExamples,
  linkedSnapshot,
  worldImages,
  worlds
} from './fixtures'
import TypeInspector from './type-inspector'

export interface CatalogSceneProps {
  scene: string
  variant: string
}

const labelKeys: Record<LabelScheme, string> = {
  vrchat: 'settings.labelScheme.vrchat',
  'platform-native': 'settings.labelScheme.platformNative',
  chilloutvr: 'settings.labelScheme.chilloutvr'
}

function FixtureLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="fixture-label">{children}</p>
}

function SceneFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <section className="fixture-scene glass p-[var(--space-4)]">{children}</section>
}

function ExploreScene({ variant }: { variant: string }): React.JSX.Element {
  const [focusFallback, setFocusFallback] = useState<HTMLElement | null>(null)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const [total, setTotal] = useState<2 | 4 | 6>(4)
  const [selected, setSelected] = useState<ExploreWorld | null>(null)
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null)
  const modes: Record<
    string,
    readonly [
      'ready' | 'loading' | 'error' | 'stale' | 'empty' | 'unavailable',
      'ready' | 'loading' | 'error' | 'stale' | 'empty' | 'unavailable'
    ]
  > = {
    loading: ['loading', 'ready'],
    error: ['error', 'ready'],
    unavailable: ['unavailable', 'ready'],
    empty: ['empty', 'empty'],
    stale: ['stale', 'ready']
  }
  const [vrcMode, cvrMode] = modes[variant] ?? ['ready', 'ready']
  const vrcSnapshot = getPlatformSnapshot('vrchat', vrcMode)
  const cvrSnapshot = getPlatformSnapshot('chilloutvr', cvrMode)
  const snapshots = [vrcSnapshot, cvrSnapshot]
  const shown = selectExploreWorlds({
    lists: {
      vrchat: rankExploreWorlds('vrchat', vrcSnapshot.worlds),
      chilloutvr: rankExploreWorlds('chilloutvr', cvrSnapshot.worlds)
    },
    filter: 'all',
    total,
    listSeeds: { vrchat: 0, chilloutvr: 1 }
  })
  const sheet =
    selected === null
      ? null
      : getWorldSnapshot(selected, variant === 'sheet-error' ? 'error' : 'ready')
  return (
    <SceneFrame>
      <FixtureLabel>
        Interactive fixture · source states are synthetic and equal-width cards preserve both
        platforms.
      </FixtureLabel>
      <main ref={setFocusFallback} tabIndex={-1}>
        <ExploreView
          worlds={shown}
          total={total}
          platformSnapshots={snapshots}
          sheet={sheet}
          sheetOpener={opener}
          focusFallback={focusFallback}
          images={worldImages}
          onTotalChange={setTotal}
          onOpenWorld={(world, trigger) => {
            setOpener(trigger)
            setSelected(world)
          }}
          onCloseSheet={() => setSelected(null)}
          onJoinRoom={(room) => setJoinedRoom(room.roomId)}
          onRefreshSheet={() => setJoinedRoom(null)}
        />
      </main>
      {joinedRoom !== null ? (
        <p className="fixture-label">Selected local room: {joinedRoom}</p>
      ) : null}
    </SceneFrame>
  )
}

function MaterialsScene(): React.JSX.Element {
  const [focusFallback, setFocusFallback] = useState<HTMLElement | null>(null)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const [opened, setOpened] = useState(false)
  const world = worlds.vrchat[0]
  if (world === undefined)
    return (
      <SceneFrame>
        <FixtureLabel>Fixture world unavailable.</FixtureLabel>
      </SceneFrame>
    )
  return (
    <SceneFrame>
      <FixtureLabel>
        Interactive fixture · production card and contained room sheet over a busy local scene.
      </FixtureLabel>
      <main
        ref={setFocusFallback}
        tabIndex={-1}
        className="relative min-h-[420px] overflow-hidden rounded-[var(--radius-panel)] p-[var(--space-4)]"
      >
        <img
          src={worldImages[world.worldRef]}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
        <div className="relative mx-auto max-w-[540px]">
          <ExploreWorldCard
            world={world}
            image={worldImages[world.worldRef]}
            onOpen={(_world, trigger) => {
              setOpener(trigger)
              setOpened(true)
            }}
          />
        </div>
        <ExploreWorldSheet
          snapshot={opened ? getWorldSnapshot(world) : null}
          image={worldImages[world.worldRef]}
          opener={opener}
          focusFallback={focusFallback}
          onClose={() => setOpened(false)}
          onJoin={() => undefined}
        />
      </main>
    </SceneFrame>
  )
}

function SemanticsScene(): React.JSX.Element {
  const linkedVrc = friends.vrchat[0]
  const linkedCvr = friends.chilloutvr[0]
  if (linkedVrc === undefined || linkedCvr === undefined)
    return (
      <SceneFrame>
        <FixtureLabel>Fixture roster unavailable.</FixtureLabel>
      </SceneFrame>
    )
  return (
    <SceneFrame>
      <FixtureLabel>
        Static samples · color is paired with visible platform, status, and policy words.
      </FixtureLabel>
      <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-4)]">
        <Avatar friend={linkedVrc} ariaLabel="Nyx online and joinable" />
        <Avatar friend={linkedCvr} variant="small" ariaLabel="Nyx in ChilloutVR" />
        <Avatar
          friend={linkedVrc}
          mergedWith={linkedCvr}
          variant="drawer"
          ariaLabel="Nyx linked across platforms"
        />
        <PolicySpacePill space="public" />
        <PolicySpacePill space="private" />
        <PolicySpacePill space="unknown" />
      </div>
      <p className="mt-[var(--space-4)] text-sm text-[var(--text-dim)]">
        Linked profile: {linkedSnapshot.profiles[0]?.defaultName ?? 'Synthetic profile'}
      </p>
    </SceneFrame>
  )
}

function InstancesScene(): React.JSX.Element {
  const { t } = useTranslation()
  const [scheme, setScheme] = useState<LabelScheme>('vrchat')
  const vrc = instanceExamples.filter((example) => example.platform === 'vrchat')
  const cvr = instanceExamples.filter((example) => example.platform === 'chilloutvr')
  const renderExamples = (examples: typeof instanceExamples): React.JSX.Element => (
    <div className="mt-[var(--space-3)] grid grid-cols-1 gap-[var(--space-2)] sm:grid-cols-2 lg:grid-cols-3">
      {examples.map(({ platform, instance }) => {
        const resolved = instancePillFor(instance, scheme)
        return (
          <div
            key={`${platform}:${instance.type}`}
            className="flex items-center justify-between gap-[var(--space-2)] rounded-[10px] border border-[var(--border)] bg-[var(--control-fill)] p-[var(--space-2)]"
          >
            <span className="truncate text-xs text-[var(--text-dim)]">{instance.type}</span>
            <InstancePill label={t(resolved.labelKey)} tier={resolved.tier} />
          </div>
        )
      })}
    </div>
  )
  return (
    <SceneFrame>
      <FixtureLabel>
        Interactive fixture · all platform-true model types, rendered with the production word-only
        pill.
      </FixtureLabel>
      <div className="fixture-controls mt-[var(--space-3)]">
        <SegmentedControl
          values={['vrchat', 'platform-native', 'chilloutvr'] as const}
          active={scheme}
          labelKeys={labelKeys}
          ariaLabel="Guide label scheme"
          onChange={setScheme}
        />
      </div>
      <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">
        <InstancePill label={t('friends.instance.private')} tier={null} />
        <InstancePill label={t('friends.instance.type.offline')} tier={null} />
        <InstancePill label={t('friends.instance.type.unknown')} tier={null} />
      </div>
      <h2 className="mt-[var(--space-4)] text-sm font-semibold text-[var(--text)]">
        VRChat · 8 types
      </h2>
      {renderExamples(vrc)}
      <h2 className="mt-[var(--space-4)] text-sm font-semibold text-[var(--text)]">
        ChilloutVR · 9 types
      </h2>
      {renderExamples(cvr)}
    </SceneFrame>
  )
}

function TypographyScene(): React.JSX.Element {
  const [sampleRoot, setSampleRoot] = useState<HTMLDivElement | null>(null)
  return (
    <SceneFrame>
      <FixtureLabel>
        Live production samples · TopBar and DashboardView from the guide bridge.
      </FixtureLabel>
      <TypeInspector root={sampleRoot} />
      <div ref={setSampleRoot} className="mt-[var(--space-4)]">
        <TopBar />
        <DashboardView />
      </div>
    </SceneFrame>
  )
}

function ControlsScene(): React.JSX.Element {
  const [scheme, setScheme] = useState<LabelScheme>('vrchat')
  return (
    <SceneFrame>
      <FixtureLabel>
        Interactive fixture · the production radiogroup supports arrow-key selection and roving
        focus.
      </FixtureLabel>
      <div className="fixture-controls mt-[var(--space-3)]">
        <SegmentedControl
          values={['vrchat', 'platform-native', 'chilloutvr'] as const}
          active={scheme}
          labelKeys={labelKeys}
          ariaLabel="Fixture label scheme"
          onChange={setScheme}
        />
      </div>
    </SceneFrame>
  )
}

function FeedbackScene({ variant }: { variant: string }): React.JSX.Element {
  const platform: Platform = variant === 'unavailable' ? 'chilloutvr' : 'vrchat'
  const mode =
    variant === 'unavailable' ||
    variant === 'loading' ||
    variant === 'error' ||
    variant === 'stale' ||
    variant === 'empty'
      ? variant
      : 'ready'
  const primarySnapshot = getPlatformSnapshot(platform, mode)
  const secondaryPlatform = platform === 'vrchat' ? 'chilloutvr' : 'vrchat'
  const secondarySnapshot = getPlatformSnapshot(secondaryPlatform)
  const snapshots = [primarySnapshot, secondarySnapshot]
  const availableWorlds = selectExploreWorlds({
    lists: {
      vrchat: rankExploreWorlds(
        'vrchat',
        primarySnapshot.platform === 'vrchat' ? primarySnapshot.worlds : secondarySnapshot.worlds
      ),
      chilloutvr: rankExploreWorlds(
        'chilloutvr',
        primarySnapshot.platform === 'chilloutvr'
          ? primarySnapshot.worlds
          : secondarySnapshot.worlds
      )
    },
    filter: 'all',
    total: 2,
    listSeeds: { vrchat: 0, chilloutvr: 1 }
  })
  return (
    <SceneFrame>
      <FixtureLabel>
        Static feedback state · source truth stays visible even when the other platform retains
        usable cards.
      </FixtureLabel>
      <ExploreDashboardPreview
        worlds={availableWorlds}
        platformSnapshots={snapshots}
        images={worldImages}
        onOpenWorld={() => undefined}
      />
    </SceneFrame>
  )
}

/** Guide-only routing surface. Every callback modifies local state or is intentionally inert. */
export default function CatalogScene({ scene, variant }: CatalogSceneProps): React.JSX.Element {
  const key = `${scene}:${variant}`
  return useMemo(() => {
    switch (scene) {
      case 'explore':
        return <ExploreScene key={key} variant={variant} />
      case 'materials':
        return <MaterialsScene key={key} />
      case 'semantics':
        return <SemanticsScene key={key} />
      case 'instances':
        return <InstancesScene key={key} />
      case 'typography':
        return <TypographyScene key={key} />
      case 'controls':
        return <ControlsScene key={key} />
      case 'feedback':
        return <FeedbackScene key={key} variant={variant} />
      default:
        return (
          <SceneFrame>
            <FixtureLabel>Unknown guide scene: {scene}</FixtureLabel>
          </SceneFrame>
        )
    }
  }, [key, scene, variant])
}
