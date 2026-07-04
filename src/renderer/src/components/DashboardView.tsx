/**
 * §9 Dashboard view (VRX-169).
 *
 * Renders:
 *  - Three stat cards (online / in-game / hot-instances), big VT323 numbers tinted by meaning.
 *  - Hot-instance grid: top 6 worlds by friend count, glass + platform tint, openness badge.
 *  - Empty state when no friends are online.
 *
 * Deferred: avatar stack (VRX-48), Join button (`joinInstance` IPC).
 */
import { Trans, useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useFriends } from '../queries/friends'
import OpennessIcon from './OpennessIcon'
import { HOT_INSTANCE_THRESHOLD } from '@shared/constants'
import {
  getDashboardStats,
  getHotInstances,
  type HotInstance
} from '../utils/dashboardAggregations'
import { INSTANCE_TYPE_LABEL_KEYS } from '../utils/instanceTypeLabels'

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

// ─── Platform glyph badge inside hot-instance card ────────────────────────────

function HotCardGlyph({ platform }: { platform: Platform }): React.JSX.Element {
  const isVrc = platform === 'vrchat'
  // bg: 22% platform color into transparent; text: 74% into white (same ratio as PlatformGlyph).
  // border: 40% platform color into transparent — all via color-mix so tokens flip in light mode.
  const bgClass = isVrc
    ? 'bg-[color-mix(in_srgb,var(--vrc)_22%,transparent)]'
    : 'bg-[color-mix(in_srgb,var(--cvr)_22%,transparent)]'
  const textClass = isVrc
    ? 'text-[color-mix(in_srgb,var(--vrc)_74%,white)]'
    : 'text-[color-mix(in_srgb,var(--cvr)_74%,white)]'
  const borderClass = isVrc
    ? 'border border-[color-mix(in_srgb,var(--vrc)_40%,transparent)]'
    : 'border border-[color-mix(in_srgb,var(--cvr)_42%,transparent)]'
  return (
    <span
      aria-hidden="true"
      className={[
        'shrink-0 w-[24px] h-[24px] rounded-[7px] grid place-items-center',
        'font-[family-name:var(--font-mono)] text-[12px] font-extrabold',
        bgClass,
        textClass,
        borderClass
      ].join(' ')}
    >
      {isVrc ? 'V' : 'C'}
    </span>
  )
}

// ─── HotInstanceCard ──────────────────────────────────────────────────────────

function HotInstanceCard({ instance }: { instance: HotInstance }): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = instance.platform === 'vrchat'

  const opennessLabelKey = INSTANCE_TYPE_LABEL_KEYS[instance.instanceType]
  const opennessLabel = t(opennessLabelKey)
  const platformLabel = isVrc ? t('dashboard.platformVrc') : t('dashboard.platformCvr')
  const platformColor = isVrc ? 'text-[var(--vrc)]' : 'text-[var(--cvr)]'
  const tintClass = isVrc ? 'tint-vrc' : 'tint-cvr'
  // 4px top edge gradient: platform → transparent (§9 spec)
  const topEdgeStyle = {
    background: isVrc
      ? 'linear-gradient(90deg, var(--vrc), transparent)'
      : 'linear-gradient(90deg, var(--cvr), transparent)'
  }

  return (
    <div className={`glass ${tintClass} overflow-hidden`}>
      {/* 4px top-edge platform stripe */}
      <div aria-hidden="true" className="h-[4px]" style={topEdgeStyle} />

      <div className="p-[15px_16px_16px]">
        {/* Row 1: platform glyph + openness badge */}
        <div className="flex items-center gap-[9px] mb-[12px]">
          <HotCardGlyph platform={instance.platform} />
          <span className="ml-auto">
            <OpennessIcon instanceType={instance.instanceType} label={opennessLabel} />
          </span>
        </div>

        {/* World title */}
        <div
          className="text-[16px] font-bold text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap"
          title={instance.worldName ?? t('friends.instance.unknownWorld')}
        >
          {instance.worldName ?? t('friends.instance.unknownWorld')}
        </div>

        {/* Platform subtitle (platform-tinted) */}
        <div className={`text-[11.5px] mt-[2px] ${platformColor}`}>{platformLabel}</div>

        {/* Footer: friend count (avatar stack deferred — VRX-48) */}
        <div className="flex items-center gap-[9px] mt-[14px]">
          {/* Avatar stack deferred (VRX-48) */}
          <span className="text-[12px] text-[var(--text-dim)]">
            <Trans
              i18nKey="dashboard.friendsHere"
              values={{ count: instance.friendCount }}
              components={{ bold: <strong className="text-[var(--text)]" /> }}
            />
          </span>
          {/* Join button deferred — joinInstance IPC not yet implemented */}
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function DashboardEmpty(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="glass flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
      <p className="text-[var(--text-dim)] text-sm font-semibold">{t('dashboard.emptyHeading')}</p>
      <p className="text-[var(--text-faint)] text-xs mt-[var(--space-1)]">
        {/* `threshold` (not `count`) — interpolation only, no plural-suffix lookup. */}
        {t('dashboard.emptyHint', { threshold: HOT_INSTANCE_THRESHOLD })}
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

  const hasData = vrcQuery.data != null || cvrQuery.data != null
  if (!hasData) {
    // Loading while ANY query is still pending (don't flash an error while the
    // other platform may yet deliver); error only when every source has failed.
    if (vrcQuery.isPending || cvrQuery.isPending) {
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
            void vrcQuery.refetch()
            void cvrQuery.refetch()
          }}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.retry')}
        </button>
      </div>
    )
  }

  const vrcFriends = vrcQuery.data ?? []
  const cvrFriends = cvrQuery.data ?? []
  const allFriends = [...vrcFriends, ...cvrFriends]

  const hotInstances = getHotInstances(allFriends)
  const stats = getDashboardStats(allFriends, hotInstances.length)

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

      {/* Hot instances section — a labelled landmark (audit W5) */}
      <section aria-labelledby="dashboard-hot-heading">
        <SectionHeading labelKey="dashboard.sectionHotInstances" id="dashboard-hot-heading" />

        {hotInstances.length === 0 ? (
          <DashboardEmpty />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '14px',
              marginBottom: '26px'
            }}
          >
            {hotInstances.map((inst) => (
              <HotInstanceCard key={inst.worldId} instance={inst} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
