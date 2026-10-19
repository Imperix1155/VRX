/**
 * §9 Dashboard view (VRX-169).
 *
 * Renders:
 *  - Three stat cards (online / in-game / hot-instances), big VT323 numbers tinted by meaning.
 *  - Popular now and Hot Instances, in the order the user picked (owner,
 *    2026-10-18). The FIRST section shows picture cards; the SECOND shows
 *    compact bars with the world picture behind them. Each section shows two
 *    cards, one per platform when both have one (`pickOnePerPlatform`).
 *  - Hot Instances are EXACT instances by friend count (VRX-237 — same
 *    instanceId, never same-world). The hero pill doubles as the Join
 *    affordance when a member is joinable (VRX-237). "See all" opens the Hot
 *    Instances page, which shows every one.
 *  - Empty state when nothing is hot.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFriends, scopeByPlatformFilter } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useHotInstanceSheet } from '../hooks/useHotInstanceSheet'
import { useFriendsStore } from '../stores/friends'
import {
  getDashboardStats,
  getHotInstances,
  pickOnePerPlatform
} from '../utils/dashboardAggregations'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import HotInstanceSheet from './HotInstanceSheet'
import HotInstanceCard from './HotInstanceCard'
import HotInstancesHeader, { HotInstancesEmpty } from './HotInstancesHeader'
import { ExploreDashboardPreviewRoute } from './ExploreRoute'

// ─── StatCard ─────────────────────────────────────────────────────────────────

/** Color token name tying each stat to its meaning (DESIGN.md §9). */
type StatTint = 'active' | 'ingame' | 'bridge'

interface StatCardProps {
  value: number
  labelKey: string
  tint: StatTint
}

function StatCard({ value, labelKey, tint }: StatCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const numberColor =
    tint === 'active'
      ? 'text-[var(--active)]'
      : tint === 'ingame'
        ? 'text-[var(--ingame)]'
        : 'text-[var(--bridge)]'

  return (
    <div className="glass glass-information p-[16px_18px]">
      <div
        className={`font-[family-name:var(--font-mono)] text-[38px] leading-none ${numberColor}`}
        aria-live="polite"
      >
        {value}
      </div>
      <div className="text-[12.5px] text-[var(--text-dim)] mt-[var(--space-1)]">{t(labelKey)}</div>
    </div>
  )
}

// ─── Section heading (VT323 kicker style — DESIGN.md §9/glass.html) ──────────

function SectionHeading({
  labelKey,
  id,
  first
}: {
  labelKey: string
  id: string
  /** First section: no top margin, so it sits under the stats like Popular now. */
  first: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={`flex items-baseline gap-[10px] mx-[2px] mb-[12px] ${first ? 'mt-0' : 'mt-[var(--space-6)]'}`}
    >
      {/* A real heading (not a styled span) so the section landmark can be
          labelled by it and screen readers get a navigable outline (audit W5). */}
      <h2
        id={id}
        className="font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-faint)]"
      >
        {t(labelKey)}
      </h2>
    </div>
  )
}

// ─── DashboardView ────────────────────────────────────────────────────────────

/**
 * §9 Dashboard — stat cards + the two ordered sections.
 * Queries both platforms and merges the results.
 *
 * Load/error states mirror FriendsList's SWR pattern (audit W5): with NO cached
 * data at all, an in-flight initial load shows "loading" and an everything-failed
 * outage shows an error — never a misleading "0 / 0 / 0, no friends online".
 * Once either platform has data, partial results render (a background refetch
 * failure or one platform erroring keeps the last good numbers).
 */
function DashboardContent(): React.JSX.Element {
  const { t } = useTranslation()
  const vrcQuery = useFriends('vrchat')
  const cvrQuery = useFriends('chilloutvr')
  // Live from the store — changes apply immediately and persist via
  // useSettingsPersistence (VRX-184).
  const popularNow = useSettingsStore((s) => s.settings.dashboardPopularNow)
  const hotEnabled = useSettingsStore((s) => s.settings.hotInstancesEnabled)
  const sectionOrder = useSettingsStore((s) => s.settings.dashboardSectionOrder)
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const [exploreDismissSignal, setExploreDismissSignal] = useState(0)
  // The card form follows the ORDER setting, not visibility: hiding the first
  // section never restyles the other one.
  const hotFirst = sectionOrder === 'hot-first'
  const popularLayout = hotFirst ? 'bar' : 'card'

  // The Dashboard is a social surface, so it honors the global platform filter
  // (VRX-66): the stats + hot instances reflect only the selected platform(s).
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const scoped = scopeByPlatformFilter(platformFilter, vrcQuery, cvrQuery)
  // A signed-out platform's disabled query stays pending forever and refetch
  // bypasses its gate, so only enabled queries drive loading and Retry.
  const enabled = scoped.filter((q) => q.isEnabled !== false)
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const notConnectedKey =
    selectedPlatform === null ? null : NOT_CONNECTED_KEY.dashboard[selectedPlatform]

  const hasData = scoped.some((q) => q.data != null)

  // Compute hot instances BEFORE any early return so the sheet hook runs on
  // every render without breaking hook order. The sheet derives from the full
  // uncapped list (the page's list), so an open sheet stays put even if its
  // card drops out of the two shown.
  const friends = scoped.flatMap((q) => q.data ?? [])
  const hotInstances = hotEnabled ? getHotInstances(friends, hotThreshold, Infinity) : []
  const allHotCount = hotInstances.length
  const shownHot = pickOnePerPlatform(hotInstances)
  const stats = getDashboardStats(friends, allHotCount)

  // The Dashboard has two contained, non-modal sheets. Opening one always
  // clears the other selection so keyboard activation cannot stack panels.
  const dismissExplore = useCallback(() => setExploreDismissSignal((signal) => signal + 1), [])
  const { selectedInstance, openSheet, closeSheet, clearSelection, fallbackFocusRef } =
    useHotInstanceSheet(hotInstances, dismissExplore)

  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-faint)]">{t('dashboard.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <div className="glass glass-information flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
        <p className="text-sm font-semibold text-[var(--text-dim)]">
          {notConnectedKey === null ? null : t(notConnectedKey)}
        </p>
        <button
          type="button"
          onClick={openAccounts}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.notConnected.openAccounts')}
        </button>
      </div>
    )
  }
  if (!hasData) {
    // Loading while ANY scoped query is still pending (don't flash an error
    // while the other platform may yet deliver); error only when every scoped
    // source has settled with nothing.
    if (enabled.some((q) => q.isPending)) {
      return (
        <>
          <p className="text-sm text-[var(--text-faint)]">{t('dashboard.loading')}</p>
          {popularNow && (
            <ExploreDashboardPreviewRoute onSheetOpen={clearSelection} cardLayout={popularLayout} />
          )}
        </>
      )
    }
    // Manual retry (same affordance as FriendsList's Refresh) — without it the
    // only recovery is the 5-minute reconcile tick or a view remount.
    return (
      <>
        <div className="flex items-center gap-[var(--space-3)]">
          <p className="text-sm text-[var(--error)]">{t('dashboard.error')}</p>
          <button
            type="button"
            onClick={() => {
              for (const q of enabled) void q.refetch()
            }}
            className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
          >
            {t('dashboard.retry')}
          </button>
        </div>
        {popularNow && (
          <ExploreDashboardPreviewRoute onSheetOpen={clearSelection} cardLayout={popularLayout} />
        )}
      </>
    )
  }

  const popularSection = popularNow ? (
    <ExploreDashboardPreviewRoute
      key="popular"
      onSheetOpen={clearSelection}
      dismissSignal={exploreDismissSignal}
      cardLayout={popularLayout}
    />
  ) : null

  // Hot instances section — a labelled landmark (audit W5).
  const hotSection = hotEnabled ? (
    <section key="hot" aria-labelledby="dashboard-hot-heading">
      {/* Header row: heading + "See all" + the quick-access threshold stepper
          (VRX-78) + help. The stepper is the sheet's focus fallback. */}
      <HotInstancesHeader
        ref={fallbackFocusRef}
        heading={
          <SectionHeading
            labelKey="dashboard.sectionHotInstances"
            id="dashboard-hot-heading"
            first={hotFirst}
          />
        }
        extra={
          allHotCount > 0 ? (
            <button
              type="button"
              aria-label={t('dashboard.seeAllAria', { count: allHotCount })}
              onClick={() => useUiStore.getState().setActiveTab('hot')}
              className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
            >
              {t('dashboard.seeAll', { count: allHotCount })}
            </button>
          ) : null
        }
      />

      {shownHot.length === 0 ? (
        <HotInstancesEmpty threshold={hotThreshold} />
      ) : (
        // `.hotwrap` = the container-query context (grid-only, so its `contain:
        // layout` never touches the heading/stepper); `.hot-grid` = max 2 columns
        // that fill the row → 1 column on a narrow pane, a lone card full-width.
        // Rules live in main.css (inline styles can't do @container/:only-child). (VRX-199)
        <div className="hotwrap">
          <div className="hot-grid">
            {shownHot.map((inst) => (
              <HotInstanceCard
                key={inst.groupKey}
                instance={inst}
                layout={hotFirst ? 'picture' : 'bar'}
                onOpen={openSheet}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  ) : null

  return (
    <div>
      {/* Stat cards row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${hotEnabled ? 3 : 2}, minmax(0, 1fr))`,
          gap: '14px',
          marginBottom: '26px'
        }}
      >
        <StatCard value={stats.onlineCount} labelKey="dashboard.statOnlineLabel" tint="active" />
        <StatCard value={stats.inGameCount} labelKey="dashboard.statInGameLabel" tint="ingame" />
        {hotEnabled && (
          <StatCard value={stats.hotCount} labelKey="dashboard.statHotLabel" tint="bridge" />
        )}
      </div>

      {hotFirst ? [hotSection, popularSection] : [popularSection, hotSection]}

      <HotInstanceSheet instance={selectedInstance} onClose={closeSheet} />
    </div>
  )
}

/** Secondary navigation follows the content in every loading/feature state. */
export default function DashboardView(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <DashboardContent />
      <div className="mt-[var(--space-4)] flex justify-end">
        <button
          type="button"
          className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
          onClick={() => {
            const { setSettingsCategory, setActiveTab } = useUiStore.getState()
            setSettingsCategory('dashboard')
            setActiveTab('settings')
          }}
        >
          {t('settings.dashboard.shortcut')}
        </button>
      </div>
    </>
  )
}
