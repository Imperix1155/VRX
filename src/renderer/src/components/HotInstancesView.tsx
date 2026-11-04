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
import { useHotGridFocus } from '../hooks/useFocusFollowsList'
import { useFriendSummary } from '../hooks/useFriendSummary'
import { useHotInstanceSheet } from '../hooks/useHotInstanceSheet'
import { useSettingsStore } from '../stores/settings'
import { getHotInstances } from '../utils/dashboardAggregations'
import FriendsSourceNotice from './FriendsSourceNotice'
import HotInstanceCard from './HotInstanceCard'
import HotInstanceSheet from './HotInstanceSheet'
import HotInstancesHeader, { HotInstancesEmpty } from './HotInstancesHeader'
import NotConnectedCard from './NotConnectedCard'

export default function HotInstancesView(): React.JSX.Element {
  const { t } = useTranslation()
  const threshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
  // The same sources and loading rules as the Dashboard.
  const {
    friends,
    hasData,
    isLoading,
    retry,
    sourceFailures,
    isAuthStatusPending,
    isNotConnected,
    notConnectedKey,
    openAccounts
  } = useFriendSummary()
  const hotInstances = getHotInstances(friends, threshold, Infinity)
  const { selectedInstance, openSheet, closeSheet, fallbackFocusRef } =
    useHotInstanceSheet(hotInstances)
  // A card that leaves by itself (its friends moved on) hands keyboard focus
  // to the card in its place, not the page.
  const {
    attach: attachHotGrid,
    onFocus: onHotGridFocus,
    onBlur: onHotGridBlur
  } = useHotGridFocus(hotInstances, fallbackFocusRef)

  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-dim)]">{t('dashboard.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <NotConnectedCard
        message={notConnectedKey === null ? null : t(notConnectedKey)}
        onOpenAccounts={openAccounts}
      />
    )
  }
  // Same gate as the Dashboard: a sign-in's empty placeholder is not a roster.
  if (!hasData) {
    if (isLoading) {
      return <p className="text-sm text-[var(--text-dim)]">{t('dashboard.loading')}</p>
    }
    return (
      <div className="flex items-center gap-[var(--space-3)]">
        <p className="text-sm text-[var(--error)]">{t('dashboard.error')}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.retry')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <FriendsSourceNotice failures={sourceFailures} wording="summary" />
      {/* The top bar holds the page's heading; this one, for screen readers
          only, puts the cards' headings under it in order (§8). */}
      <section aria-labelledby="hot-instances-heading">
        <h2 id="hot-instances-heading" className="sr-only">
          {t('dashboard.sectionHotInstances')}
        </h2>
        <div className="mb-[12px]">
          <HotInstancesHeader ref={fallbackFocusRef} />
        </div>
        {hotInstances.length === 0 ? (
          <HotInstancesEmpty threshold={threshold} />
        ) : (
          <div className="hotwrap">
            <div
              ref={attachHotGrid}
              className="hot-grid hot-grid--picture"
              onFocus={onHotGridFocus}
              onBlur={onHotGridBlur}
            >
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
