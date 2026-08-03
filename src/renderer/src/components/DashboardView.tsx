/**
 * §9 Dashboard view (VRX-169).
 *
 * Renders:
 *  - Three stat cards (online / in-game / hot-instances), big VT323 numbers tinted by meaning.
 *  - Hot-instance grid: top 6 EXACT instances by friend count (VRX-237 — same
 *    instanceId, never same-world) — the VRX-198 card (world name + shared
 *    instance pill hero + who's-here names + quiet platform pill). The hero
 *    pill doubles as the Join affordance when a member is joinable (VRX-237).
 *  - Empty state when no friends are online.
 *
 * Deferred: world thumbnail (VRX-48) + whole-card click → detail panel (VRX-59).
 */
import { useTranslation } from 'react-i18next'
import { isFriendJoinable } from '@shared/joinability'
import { useFriends, scopeByPlatformFilter } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useFriendsStore } from '../stores/friends'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'
import NumberStepper from './NumberStepper'
import InstancePill from './InstancePill'
import { OPENNESS_TIER } from '../utils/instancePill'
import PlatformPill from './PlatformPill'
import {
  getDashboardStats,
  getHotInstances,
  type HotInstance
} from '../utils/dashboardAggregations'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { stripInstanceSuffix } from '../utils/worldName'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'

/** How many friend names show on a card before collapsing to "+N" (VRX-198). */
const WHO_HERE_MAX_NAMES = 4

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
    <div className="glass p-[16px_18px]">
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

// ─── HotInstanceCard (§9, VRX-198; exact-instance + card Join VRX-237) ───────
//
// Visual-weight order, top to bottom: world name → instance pill (hero) →
// who's-here → platform (quiet a11y label). A 2×2 grid: the world name (r1c1) and
// who's-here (r2c1) share the left 1fr column; the instance pill (r1c2) and platform
// pill (r2c2) share a right column floored at 78px and grown to `max-content`, so the
// two pills are always the SAME width and their edges line up (a clean rectangle).
// The whole-card click → detail panel (world image, full who's-here, the instance
// number) is deferred to VRX-59; the card is intentionally NOT clickable yet, so
// the hero pill's Join is its OWN explicit control — a card click never joins.

function HotInstanceCard({ instance }: { instance: HotInstance }): React.JSX.Element {
  const { t } = useTranslation()
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  // The ONE shared join flow (VRX-237): the card's Join routes through a MEMBER
  // friend — any member works because they provably share the exact instance.
  // `members` is alphabetical, so the first JOINABLE member is a deterministic
  // target. The confirmation dialog (VRX-210) intercepts via the same flow.
  const { isJoining, joinFailureFor, join } = useJoinInstance()
  const joinTarget = instance.members.find(isFriendJoinable) ?? null
  const joinFailure = joinTarget !== null ? joinFailureFor(joinTarget) : null
  const isVrc = instance.platform === 'vrchat'

  const opennessLabel = t(LABEL_KEYS_BY_SCHEME[labelScheme][instance.instanceType])
  const tier = OPENNESS_TIER[instance.instanceType] ?? null
  // Display-only: drop the CVR "(#instanceNumber)" from the face (VRX-198).
  const worldName = instance.worldName
    ? stripInstanceSuffix(instance.worldName)
    : t('friends.instance.unknownWorld')
  const tintClass = isVrc ? 'tint-vrc' : 'tint-cvr'
  const topEdgeStyle = {
    background: isVrc
      ? 'linear-gradient(90deg, var(--vrc), transparent)'
      : 'linear-gradient(90deg, var(--cvr), transparent)'
  }

  // Who's-here: first WHO_HERE_MAX_NAMES names, then "+N". The full list feeds the
  // screen-reader label so nobody is hidden from assistive tech (audit W5 pattern).
  const shownNames = instance.friendNames.slice(0, WHO_HERE_MAX_NAMES)
  const overflow = instance.friendCount - shownNames.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: instance.friendCount,
    names: instance.friendNames.join(', ')
  })

  function joinCardTarget(event: React.MouseEvent<HTMLButtonElement>): void {
    // Belt-and-suspenders containment for the day the whole-card click (VRX-59)
    // lands: join wins over open, always — same law as the friend row.
    event.stopPropagation()
    if (joinTarget !== null) void join(joinTarget)
  }

  return (
    <div className={`glass ${tintClass} overflow-hidden`}>
      {/* 4px top-edge platform stripe */}
      <div aria-hidden="true" className="h-[4px]" style={topEdgeStyle} />

      <div
        className="p-[14px_16px]"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(78px, max-content)',
          gridTemplateRows: 'auto 1fr',
          columnGap: '12px',
          rowGap: '16px',
          minHeight: '96px'
        }}
      >
        {/* World name — top-left. 25px with descender room (line-height 1.5) so
            'y'/'g'/'p' tails aren't clipped; relaxes VRX-198's exact-pill-height
            rule (the 26px/leading-none match sliced 5.5px of descender). Shares
            the line with the pill ("lined paper"); truncates with ellipsis. */}
        <div
          className="col-start-1 row-start-1 self-center min-w-0 text-[25px] font-bold leading-[1.5] text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap"
          // Tooltip shows the FULL untrimmed name (VRX-199) — reveals both a
          // truncated long name AND the stripped `(#…)` suffix on hover, until the
          // detail panel (VRX-59) lands. Falls back to the stripped/unknown label.
          title={instance.worldName ?? worldName}
        >
          {worldName}
        </div>

        {/* Instance pill (hero) — top-right, pinned. VRX-237: when a member is
            joinable the pill IS the card's Join affordance — the same row-pill
            pattern (VRX-166: button variant + shared isFriendJoinable gate +
            role="status" denial blip), routed through the ONE shared join flow
            so the VRX-210 confirmation dialog intercepts identically. The grid
            placement moves to the wrapper so the pill keeps the shared column. */}
        {joinTarget !== null ? (
          <span className="col-start-2 row-start-1 self-center relative block" data-join-pill>
            <InstancePill
              label={opennessLabel}
              tier={tier}
              // The wrapper is a grid item stretched to the shared pill column;
              // the pill inside must fill it (w-full + the FriendsList width
              // floor) or short labels render a shrunk, left-aligned pill and
              // the two-pills-same-width invariant breaks (L8).
              className="w-full min-w-[78px]"
              onJoin={joinCardTarget}
              disabled={isJoining}
              aria-label={t('friends.joinAria', {
                name: joinTarget.displayName,
                // The STRIPPED display name — same as the visible title, never
                // the raw `(#…)`-suffixed wire name.
                world: worldName
              })}
            />
            <span
              role="status"
              className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-[var(--space-1)] text-[12px] text-[var(--text-dim)]"
            >
              {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
            </span>
          </span>
        ) : (
          <InstancePill
            label={opennessLabel}
            tier={tier}
            className="col-start-2 row-start-1 self-center"
          />
        )}

        {/* Who's-here — bottom-left; names truncate BEFORE the shrink-proof "+N" so
            the overflow count never gets clipped on a narrow card. Full list is in
            the aria-label so screen readers get everyone. */}
        <div
          className="col-start-1 row-start-2 self-end flex min-w-0 items-baseline text-[13.5px] leading-[1.2]"
          aria-label={whoHereAria}
        >
          <span className="min-w-0 truncate text-[var(--names-lift)]">{shownNames.join(', ')}</span>
          {overflow > 0 && (
            <span className="ml-[4px] shrink-0 font-bold text-[var(--text)]">
              {t('dashboard.friendsOverflow', { count: overflow })}
            </span>
          )}
        </div>

        {/* Platform pill (quiet a11y label) — bottom-right */}
        <PlatformPill platform={instance.platform} className="col-start-2 row-start-2 self-end" />
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function DashboardEmpty({ threshold }: { threshold: number }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="glass flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
      <p className="text-[var(--text-dim)] text-sm font-semibold">{t('dashboard.emptyHeading')}</p>
      <p className="text-[var(--text-faint)] text-xs mt-[var(--space-1)]">
        {/* `threshold` (not `count`) — interpolation only, no plural-suffix lookup. */}
        {t('dashboard.emptyHint', { threshold })}
      </p>
    </div>
  )
}

// ─── Section heading (VT323 kicker style — DESIGN.md §9/glass.html) ──────────

function SectionHeading({ labelKey, id }: { labelKey: string; id: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline gap-[10px] mx-[2px] mb-[12px] mt-[var(--space-6)]">
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
 * §9 Dashboard — stat cards + hot-instance grid.
 * Queries both platforms and merges the results.
 *
 * Load/error states mirror FriendsList's SWR pattern (audit W5): with NO cached
 * data at all, an in-flight initial load shows "loading" and an everything-failed
 * outage shows an error — never a misleading "0 / 0 / 0, no friends online".
 * Once either platform has data, partial results render (a background refetch
 * failure or one platform erroring keeps the last good numbers).
 */
export default function DashboardView(): React.JSX.Element {
  const { t } = useTranslation()
  const vrcQuery = useFriends('vrchat')
  const cvrQuery = useFriends('chilloutvr')
  // Hot-grid threshold (VRX-78): live from the store — changes apply
  // immediately and persist via useSettingsPersistence (VRX-184).
  const hotThreshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // The Dashboard is a social surface, so it honors the global platform filter
  // (VRX-66): the stats + hot instances reflect only the selected platform(s).
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const scoped = scopeByPlatformFilter(platformFilter, vrcQuery, cvrQuery)
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const notConnectedKey =
    selectedPlatform === null ? null : NOT_CONNECTED_KEY.dashboard[selectedPlatform]

  const hasData = scoped.some((q) => q.data != null)
  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-faint)]">{t('dashboard.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <div className="glass flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
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
    if (scoped.some((q) => q.isPending)) {
      return <p className="text-sm text-[var(--text-faint)]">{t('dashboard.loading')}</p>
    }
    // Manual retry (same affordance as FriendsList's Refresh) — without it the
    // only recovery is the 5-minute reconcile tick or a view remount.
    return (
      <div className="flex items-center gap-[var(--space-3)]">
        <p className="text-sm text-[var(--error)]">{t('dashboard.error')}</p>
        <button
          type="button"
          onClick={() => {
            for (const q of scoped) void q.refetch()
          }}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.retry')}
        </button>
      </div>
    )
  }

  const friends = scoped.flatMap((q) => q.data ?? [])

  const hotInstances = getHotInstances(friends, hotThreshold)
  const stats = getDashboardStats(friends, hotInstances.length)

  return (
    <div>
      {/* Stat cards row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px',
          marginBottom: '26px'
        }}
      >
        <StatCard value={stats.onlineCount} labelKey="dashboard.statOnlineLabel" tint="active" />
        <StatCard value={stats.inGameCount} labelKey="dashboard.statInGameLabel" tint="ingame" />
        <StatCard value={stats.hotCount} labelKey="dashboard.statHotLabel" tint="bridge" />
      </div>

      {/* Hot instances section — a labelled landmark (audit W5). */}
      <section aria-labelledby="dashboard-hot-heading">
        {/* Header row: heading + the quick-access threshold stepper (VRX-78).
            The issue AC said "Friends panel header", but the control belongs
            next to the grid it changes — deviation flagged in the PR. */}
        <div className="flex items-center justify-between gap-[var(--space-4)]">
          <SectionHeading labelKey="dashboard.sectionHotInstances" id="dashboard-hot-heading" />
          <NumberStepper
            value={hotThreshold}
            min={HOT_INSTANCE_THRESHOLD_MIN}
            max={HOT_INSTANCE_THRESHOLD_MAX}
            onChange={(next) => updateSettings({ hotInstanceThreshold: next })}
            ariaLabel={t('dashboard.hotThresholdAria')}
          />
        </div>

        {hotInstances.length === 0 ? (
          <DashboardEmpty threshold={hotThreshold} />
        ) : (
          // `.hotwrap` = the container-query context (grid-only, so its `contain:
          // layout` never touches the heading/stepper); `.hot-grid` = max 2 columns
          // that fill the row → 1 column on a narrow pane, a lone card full-width.
          // Rules live in main.css (inline styles can't do @container/:only-child). (VRX-199)
          <div className="hotwrap">
            <div className="hot-grid">
              {hotInstances.map((inst) => (
                <HotInstanceCard key={inst.groupKey} instance={inst} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
