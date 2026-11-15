/**
 * A friend's History (owner, 2026-11-15): what VRX saved about this friend,
 * opened from the History button in the friend card. One layout for a VRChat
 * friend, a ChilloutVR friend, and a linked person (both accounts in one
 * list, each row saying which platform).
 *
 * It reads this computer's saved activity through main, a page at a time,
 * and asks no platform for anything. The live list is merged in, so something
 * that happens while it is open shows up.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityEntry, ActivityFriendRef, ActivityPageCursor } from '@shared/activity'
import type { Friend, Platform } from '@shared/types'
import { asTranslate } from '../i18n/translate'
import { useActivityPager } from '../hooks/useActivityPager'
import { useActivity } from '../queries/activity'
import { mergeActivity } from '../utils/activityPaging'
import { activityTimeFormats, describeActivity, formatActivityTime } from '../utils/activityText'
import { inPlatformOrder } from '../utils/platformOrder'
import LinkedDialog from './LinkedDialog'
import PlatformPill from './PlatformPill'

function friendKey(platform: Platform, platformUserId: string): string {
  return `${platform}\u0000${platformUserId}`
}

export default function FriendHistoryDialog({
  accounts,
  name,
  onClose
}: {
  /** The account shown, or a linked person's accounts. */
  accounts: readonly Friend[]
  name: string
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const live = useActivity().data

  const ordered = useMemo(() => inPlatformOrder([...accounts]), [accounts])
  const ownerKey = ordered
    .map((account) => friendKey(account.platform, account.platformUserId))
    .join('|')
  const { friends, start, keys } = useMemo(() => {
    const refs: ActivityFriendRef[] = []
    const cursors: ActivityPageCursor[] = []
    const ids = new Set<string>()
    for (const account of ordered) {
      refs.push({ platform: account.platform, friendId: account.platformUserId })
      ids.add(friendKey(account.platform, account.platformUserId))
      if (!cursors.some((cursor) => cursor.platform === account.platform)) {
        cursors.push({ platform: account.platform, beforeId: null })
      }
    }
    return { friends: refs, start: cursors, keys: ids }
    // Rebuilt only when the people change, not on every roster refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  const pager = useActivityPager({
    restartKey: ownerKey,
    start,
    filter: 'all',
    friends,
    revealFirst: true
  })

  const entries = useMemo(() => {
    const mine = (live ?? []).filter((entry) =>
      keys.has(friendKey(entry.platform, entry.platformUserId))
    )
    // Live entries newer than the pages read so far only: an older live entry
    // sits in a page that has not been shown yet.
    const oldestShown = pager.entries.reduce(
      (oldest, entry) => Math.min(oldest, entry.id),
      Infinity
    )
    const fresh = pager.canShowOlder ? mine.filter((entry) => entry.id > oldestShown) : mine
    return mergeActivity(pager.entries, fresh)
  }, [live, keys, pager.entries, pager.canShowOlder])

  const formats = useMemo(() => activityTimeFormats(i18n.language), [i18n.language])
  const now = new Date()
  const showsPlatform = start.length > 1
  const translate = asTranslate(t)

  let body: React.JSX.Element
  if (entries.length > 0) {
    body = (
      <ol className="flex flex-col gap-[6px]">
        {entries.map((entry: ActivityEntry) => {
          const at = new Date(entry.at)
          return (
            <li key={entry.id} className={`platform-row platform-row--${entry.platform}`}>
              <div className="flex w-full items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                {/* The full world name on hover, a "(#…)" tag included, like
                    the Activity page (owner rule VRX-199). */}
                <span
                  className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]"
                  title={entry.worldName ?? undefined}
                >
                  {describeActivity(entry, translate)}
                </span>
                {showsPlatform && (
                  <span className="flex w-[88px] shrink-0">
                    <PlatformPill platform={entry.platform} className="w-full" />
                  </span>
                )}
                <time
                  dateTime={at.toISOString()}
                  className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-[var(--text-dim)]"
                >
                  {formatActivityTime(at, now, formats)}
                </time>
              </div>
            </li>
          )
        })}
      </ol>
    )
  } else if (!pager.ready || pager.status === 'loading') {
    body = <p className="text-[13px] text-[var(--text-dim)]">{t('history.loading')}</p>
  } else if (pager.status === 'failed') {
    body = <p className="text-[13px] text-[var(--error)]">{t('history.error')}</p>
  } else {
    body = (
      <div className="py-[var(--space-4)] text-center">
        <p className="text-sm font-semibold text-[var(--text-dim)]">{t('history.emptyHeading')}</p>
        <p className="mx-auto mt-[var(--space-1)] max-w-[40ch] text-balance text-xs text-[var(--text-dim)]">
          {t('history.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <LinkedDialog title={t('history.title', { name })} onClose={onClose}>
      {/* One platform: its name once, here. Two: each row carries its own. */}
      {!showsPlatform && start[0] && (
        <div className="mb-[var(--space-3)] flex">
          <PlatformPill platform={start[0].platform} />
        </div>
      )}
      <section aria-label={t('history.activityHeading')}>
        <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase">
          {t('history.activityHeading')}
        </h3>
        <div className="max-h-[min(360px,50vh)] overflow-y-auto pr-[var(--space-1)]">
          {body}
          {(pager.canShowOlder || (pager.status === 'failed' && entries.length > 0)) && (
            <div className="mt-[var(--space-3)] flex items-center justify-center gap-[var(--space-3)]">
              {pager.status === 'failed' ? (
                <>
                  <p className="text-xs text-[var(--text-dim)]">{t('activity.olderFailed')}</p>
                  <button
                    type="button"
                    onClick={pager.retry}
                    className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
                  >
                    {t('activity.retry')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={pager.showOlder}
                  className="rounded-control px-[var(--space-4)] py-[var(--space-2)] text-xs font-medium text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
                >
                  {t('activity.showOlder')}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </LinkedDialog>
  )
}
