/**
 * Hot Instances page (owner, 2026-10-18). Every hot instance for the selected
 * platform filter, most friends first, as picture cards. The Dashboard shows
 * only two of these; this page has the room for all of them.
 *
 * Shares the Dashboard's pieces exactly: `getHotInstances` (exact-instance
 * grouping, VRX-237), `HotInstanceCard`, the threshold/help header, the empty
 * state, and the non-modal `HotInstanceSheet`. The TopBar owns the page heading.
 * The Settings → Dashboard "Hot Instances" switch only hides the Dashboard
 * section; this page is always available.
 */
import { useTranslation } from 'react-i18next'
import { useFriends, scopeByPlatformFilter } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useHotInstanceSheet } from '../hooks/useHotInstanceSheet'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { getHotInstances } from '../utils/dashboardAggregations'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import HotInstanceCard from './HotInstanceCard'
import HotInstanceSheet from './HotInstanceSheet'
import HotInstancesHeader, { HotInstancesEmpty } from './HotInstancesHeader'

export default function HotInstancesView(): React.JSX.Element {
  const { t } = useTranslation()
  const vrcQuery = useFriends('vrchat')
  const cvrQuery = useFriends('chilloutvr')
  const threshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const scoped = scopeByPlatformFilter(platformFilter, vrcQuery, cvrQuery)
  // A signed-out platform's disabled query stays pending forever and refetch
  // bypasses its gate, so only enabled queries drive loading and Retry.
  const enabled = scoped.filter((q) => q.isEnabled !== false)
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const notConnectedKey =
    selectedPlatform === null ? null : NOT_CONNECTED_KEY.dashboard[selectedPlatform]

  const friends = scoped.flatMap((q) => q.data ?? [])
  const hotInstances = getHotInstances(friends, threshold, Infinity)
  const { selectedInstance, openSheet, closeSheet, fallbackFocusRef } =
    useHotInstanceSheet(hotInstances)

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
  if (!scoped.some((q) => q.data != null)) {
    if (enabled.some((q) => q.isPending)) {
      return <p className="text-sm text-[var(--text-faint)]">{t('dashboard.loading')}</p>
    }
    return (
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
    )
  }

  return (
    <div>
      <section aria-label={t('dashboard.sectionHotInstances')}>
        <div className="mb-[12px]">
          <HotInstancesHeader ref={fallbackFocusRef} />
        </div>
        {hotInstances.length === 0 ? (
          <HotInstancesEmpty threshold={threshold} />
        ) : (
          <div className="hotwrap">
            <div className="hot-grid hot-grid--picture">
              {hotInstances.map((inst) => (
                <HotInstanceCard
                  key={inst.groupKey}
                  instance={inst}
                  layout="picture"
                  onOpen={openSheet}
                />
              ))}
            </div>
          </div>
        )}
      </section>
      <HotInstanceSheet instance={selectedInstance} onClose={closeSheet} />
    </div>
  )
}
