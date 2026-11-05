import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreWorldSnapshot } from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import type { LabelScheme } from '@shared/types'
import { Avatar } from '@renderer/components/Avatar'
import DashboardView from '@renderer/components/DashboardView'
import ExploreDashboardPreview from '@renderer/components/ExploreDashboardPreview'
import ExploreView from '@renderer/components/ExploreView'
import ExploreWorldCard from '@renderer/components/ExploreWorldCard'
import ExploreWorldSheet from '@renderer/components/ExploreWorldSheet'
import InstancePill from '@renderer/components/InstancePill'
import PolicySpacePill from '@renderer/components/PolicySpacePill'
import SegmentedControl from '@renderer/components/SegmentedControl'
import Toggle from '@renderer/components/Toggle'
import NumberStepper from '@renderer/components/NumberStepper'
import PlatformPill from '@renderer/components/PlatformPill'
import NotConnectedCard from '@renderer/components/NotConnectedCard'
import FinePrint from '@renderer/components/FinePrint'
import { FavoriteStarButton } from '@renderer/components/FavoriteStar'
import TopBar from '@renderer/components/TopBar'
import { instancePillFor } from '@renderer/utils/instancePill'
import { FRIEND_ACTION_BUTTON } from '@renderer/utils/friendActions'
import { SECONDARY_BUTTON } from '@renderer/components/setup/setupModel'
import {
  backgroundPicture,
  friends,
  getPlatformSnapshot,
  getWorldSnapshot,
  instanceExamples,
  linkedSnapshot,
  worldImages,
  worlds
} from './fixtures'
import TypeInspector from './type-inspector'
import appIcon from '../../build/icon.png'
import smallIcon from '../../resources/icon-16.png'
import mediumIcon from '../../resources/icon-24.png'
import { sourceModesFor } from './scenarios'

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

function SceneFrame({
  children,
  information = false
}: {
  children: React.ReactNode
  /** Production information backing, for samples that carry meaning (§3). */
  information?: boolean
}): React.JSX.Element {
  return (
    <section
      className={`fixture-scene glass${information ? ' glass-information' : ''} p-[var(--space-4)]`}
    >
      {children}
    </section>
  )
}

function IconScene(): React.JSX.Element {
  return (
    <SceneFrame>
      <FixtureLabel>Static sample · shipped VRX icon assets</FixtureLabel>
      <div className="fixture-app-icon">
        <img src={appIcon} width={128} height={128} alt="VRX app icon" />
        <div className="fixture-app-icon__sizes">
          {[16, 24, 32, 48, 64].map((size) => (
            <figure key={size}>
              <img
                src={size === 16 ? smallIcon : size === 24 ? mediumIcon : appIcon}
                width={size}
                height={size}
                alt={`VRX at ${size} pixels`}
              />
              <figcaption>{size} px</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <p className="fixture-label">
        Blue V at left, silver R above orange X. The clipped smoked-glass case keeps its colored
        rails and gently rounded chamfer transitions.
      </p>
    </SceneFrame>
  )
}

function ExploreScene({ variant }: { variant: string }): React.JSX.Element {
  const [focusFallback, setFocusFallback] = useState<HTMLElement | null>(null)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const [total, setTotal] = useState<2 | 4 | 6>(4)
  const [sheet, setSheet] = useState<ExploreWorldSnapshot | null>(null)
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null)
  const [vrcMode, cvrMode] = sourceModesFor(variant)
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
            setSheet(
              getWorldSnapshot(
                world,
                variant === 'sheet-error'
                  ? 'error'
                  : variant === 'sheet-loading'
                    ? 'loading'
                    : variant === 'sheet-stale'
                      ? 'stale'
                      : 'ready'
              )
            )
          }}
          onCloseSheet={() => setSheet(null)}
          onJoinRoom={(room) => setJoinedRoom(room.roomId)}
          onRefreshSheet={() => {
            if (sheet) setSheet(getWorldSnapshot(sheet.world))
            setJoinedRoom(null)
          }}
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
  const [snapshot, setSnapshot] = useState<ExploreWorldSnapshot | null>(null)
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
              setSnapshot(getWorldSnapshot(world))
            }}
          />
        </div>
        <ExploreWorldSheet
          snapshot={snapshot}
          image={worldImages[world.worldRef]}
          opener={opener}
          focusFallback={focusFallback}
          onClose={() => setSnapshot(null)}
          onRefresh={() => setSnapshot(getWorldSnapshot(world))}
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
    <SceneFrame information>
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

/** The shared controls, each one the production component or class. */
function ControlsScene(): React.JSX.Element {
  const { t } = useTranslation()
  const [scheme, setScheme] = useState<LabelScheme>('vrchat')
  const [on, setOn] = useState(true)
  const [threshold, setThreshold] = useState(2)
  const [starred, setStarred] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <SceneFrame information>
      <FixtureLabel>
        Interactive fixture · production controls. Segmented controls are radiogroups: one Tab stop,
        then arrow keys.
      </FixtureLabel>
      <div className="fixture-control-grid mt-[var(--space-3)]">
        <span className="fixture-control-name">SegmentedControl</span>
        <SegmentedControl
          values={['vrchat', 'platform-native', 'chilloutvr'] as const}
          active={scheme}
          labelKeys={labelKeys}
          ariaLabel="Fixture label scheme"
          onChange={setScheme}
        />
        <span className="fixture-control-name">Toggle</span>
        <Toggle checked={on} onChange={setOn} ariaLabel="Fixture toggle" />
        <span className="fixture-control-name">NumberStepper</span>
        <NumberStepper
          value={threshold}
          min={1}
          max={10}
          onChange={setThreshold}
          ariaLabel="Fixture threshold"
        />
        <span className="fixture-control-name">FavoriteStarButton</span>
        <span className="flex items-center gap-[var(--space-2)]">
          <FavoriteStarButton
            on={starred}
            label={starred ? 'Starred' : 'Not starred'}
            hint="Star"
            expanded={false}
            controls="fixture-favorite"
            onToggle={() => setStarred((value) => !value)}
          />
          <FavoriteStarButton
            on={starred}
            shape="round"
            label={starred ? 'Starred' : 'Not starred'}
            hint="Star"
            expanded={false}
            controls="fixture-favorite"
            onToggle={() => setStarred((value) => !value)}
          />
        </span>
        <span className="fixture-control-name">Quiet button</span>
        <span>
          <button
            type="button"
            className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
          >
            {t('settings.accounts.retry')}
          </button>
        </span>
        <span className="fixture-control-name">FRIEND_ACTION_BUTTON</span>
        <span className="flex items-center gap-[var(--space-2)]">
          <button
            type="button"
            className={FRIEND_ACTION_BUTTON}
            aria-disabled={busy || undefined}
            onClick={() => setBusy((value) => !value)}
          >
            {t(busy ? 'friendActions.accepting' : 'friendActions.accept')}
          </button>
          <span className="text-[11.5px] text-[var(--text-dim)]">
            Press: aria-disabled while busy, focus stays.
          </span>
        </span>
        <span className="fixture-control-name">SECONDARY_BUTTON</span>
        <span>
          <button type="button" className={SECONDARY_BUTTON}>
            {t('setup.skip')}
          </button>
        </span>
        <span className="fixture-control-name">FinePrint</span>
        <FinePrint summary={t('setup.signin.storage')} full={t('setup.signin.storageFull')} />
      </div>
      <p className="fixture-control-name mt-[var(--space-4)] mb-[var(--space-2)]">
        NotConnectedCard
      </p>
      <div className="max-w-[420px]">
        <NotConnectedCard message="ChilloutVR isn't connected." onOpenAccounts={() => undefined} />
      </div>
    </SceneFrame>
  )
}

/**
 * Layered glass (DESIGN.md §3): the five layers over a busy local picture,
 * each labeled with its production class.
 */
function LayersScene(): React.JSX.Element {
  const { t } = useTranslation()
  const vrc = friends.vrchat[0]
  const cvr = friends.chilloutvr[0]
  const publicPill = instancePillFor({ type: 'public' }, 'vrchat')
  const groupPill = instancePillFor({ type: 'group-plus' }, 'vrchat')
  return (
    <div className="fixture-layers">
      <img src={backgroundPicture} alt="" className="fixture-layers__picture" />
      <p className="fixture-layer-tag fixture-layers__canvas-tag">
        Layer 0 · canvas: picture or aurora
      </p>
      <section className="glass glass-panel fixture-layers__panel">
        <p className="fixture-layer-tag">Layer 2 · .glass .glass-panel</p>
        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <div className="glass glass-layer min-w-0 p-[16px_18px]">
            <div className="font-[family-name:var(--font-mono)] text-[38px] leading-none tabular-nums text-[var(--text)]">
              13
            </div>
            <div className="mt-[var(--space-1)] text-[12.5px] text-[var(--text-dim)]">
              {t('dashboard.statOnlineLabel')}
            </div>
            <p className="fixture-layer-tag mt-[var(--space-2)]">Layer 3 · .glass .glass-layer</p>
          </div>
          <div className="setting-card">
            <div className="setting-row">
              <span className="text-[13px] font-semibold text-[var(--text)]">
                {t('settings.dashboard.popular.label')}
              </span>
              <Toggle checked onChange={() => undefined} ariaLabel="Sample switch" />
            </div>
            <p className="fixture-layer-tag mt-[var(--space-2)]">Layer 3 · .setting-card</p>
          </div>
        </div>
        <div className="mt-[var(--space-3)] grid gap-[6px]">
          {(
            [
              ['vrchat', vrc, publicPill],
              ['chilloutvr', cvr, groupPill]
            ] as const
          ).map(([platform, friend, pill]) =>
            friend === undefined ? null : (
              <div
                key={platform}
                className={`platform-row platform-row--${platform} flex items-center gap-[var(--space-3)] py-[var(--space-2)] pr-[var(--space-2)] pl-[var(--space-3)]`}
              >
                <Avatar friend={friend} variant="small" ariaLabel={friend.displayName} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
                  {friend.displayName}
                </span>
                <span className="fixture-layer-tag">Layer 4 · .glass-chip</span>
                <PlatformPill platform={platform} />
                <InstancePill label={t(pill.labelKey)} tier={pill.tier} />
              </div>
            )
          )}
          <div className="platform-row platform-row--vrx flex items-center gap-[var(--space-3)] py-[var(--space-2)] pr-[var(--space-2)] pl-[var(--space-3)]">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
              {linkedSnapshot.profiles[0]?.defaultName ?? 'Linked person'}
            </span>
            <span className="fixture-layer-tag">.platform-row--vrx</span>
            <PolicySpacePill space="public" />
          </div>
          <div className="platform-row platform-row--none flex items-center p-[var(--space-2)] text-[12.5px] text-[var(--text-dim)]">
            {t('dashboard.loading')}
            <span className="fixture-layer-tag ml-auto">.platform-row--none</span>
          </div>
        </div>
      </section>
      <div className="glass glass-information fixture-layers__menu" role="presentation">
        <p className="fixture-layer-tag">Opaque · .glass-information</p>
        <p className="text-[12.5px] text-[var(--text)]">
          Menus and panels that must keep their colors whatever is behind them.
        </p>
      </div>
      <div className="glass glass-frosted-heavy glass-information fixture-layers__dialog">
        <p className="fixture-layer-tag">Dialog · .glass-frosted-heavy</p>
        <p className="fixture-layer-tag">+ .glass-information</p>
        <p className="text-[13px] font-semibold text-[var(--text)]">A true confirmation modal</p>
      </div>
    </div>
  )
}

function FeedbackScene({ variant }: { variant: string }): React.JSX.Element {
  const [vrcMode, cvrMode] = sourceModesFor(variant)
  const vrcSnapshot = getPlatformSnapshot('vrchat', vrcMode)
  const cvrSnapshot = getPlatformSnapshot('chilloutvr', cvrMode)
  const snapshots = [vrcSnapshot, cvrSnapshot]
  const availableWorlds = selectExploreWorlds({
    lists: {
      vrchat: rankExploreWorlds('vrchat', vrcSnapshot.worlds),
      chilloutvr: rankExploreWorlds('chilloutvr', cvrSnapshot.worlds)
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
      case 'icons':
        return <IconScene key={key} />
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
      case 'layers':
        return <LayersScene key={key} />
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
