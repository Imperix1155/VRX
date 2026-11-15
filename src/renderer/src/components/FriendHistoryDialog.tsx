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
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  FRIEND_LIST_KINDS,
  type ActivityEntry,
  type ActivityFriendRef,
  type ActivityPageCursor,
  type FriendHistoryFacts
} from '@shared/activity'
import type { Friend, Platform } from '@shared/types'
import { asTranslate } from '../i18n/translate'
import { useActivityPager } from '../hooks/useActivityPager'
import { fetchFriendHistory, useActivity } from '../queries/activity'
import { mergeActivity } from '../utils/activityPaging'
import {
  activityTimeFormats,
  describeActivity,
  formatActivityTime,
  formatStay
} from '../utils/activityText'
import { stripInstanceSuffix } from '../utils/worldName'
import { inPlatformOrder } from '../utils/platformOrder'
import LinkedDialog from './LinkedDialog'
import PlatformPill from './PlatformPill'

function friendKey(platform: Platform, platformUserId: string): string {
  return `${platform}\u0000${platformUserId}`
}

const DAY_MS = 86_400_000
/** Earlier names shown before "Show all". */
const NAMES_SHOWN = 3
const FRIEND_LIST_KIND_SET: ReadonlySet<string> = new Set(FRIEND_LIST_KINDS)

/** How long ago, in the largest unit that fits: days, months or years. */
function ageOf(since: number, now: number, language: string): string | null {
  const days = Math.floor((now - since) / DAY_MS)
  if (days < 1) return null
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always' })
  if (days < 60) return format.format(-days, 'day')
  if (days < 730) return format.format(-Math.floor(days / 30.44), 'month')
  return format.format(-Math.floor(days / 365.25), 'year')
}

/** What is saved about one friendship: friends since and earlier names. The
 *  same rows in the same order on both platforms; a row with nothing saved
 *  is left out. */
function FriendFacts({
  facts,
  showsPlatform,
  now
}: {
  facts: FriendHistoryFacts
  showsPlatform: boolean
  now: number
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [allNames, setAllNames] = useState(false)
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language]
  )
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  if (facts.since === null && facts.previousNames.length === 0 && facts.met === null) return null
  const met = facts.met
  const lastWorld =
    met === null || met.lastWorldName === null ? '' : stripInstanceSuffix(met.lastWorldName).trim()
  const lastDate = met === null ? '' : dayFormat.format(new Date(met.lastAt))
  let since: string | null = null
  if (facts.since !== null) {
    const date = dayFormat.format(new Date(facts.since))
    const age = facts.sinceKnown ? ageOf(facts.since, now, i18n.language) : null
    since = !facts.sinceKnown
      ? t('history.sinceBefore', { date })
      : age === null
        ? date
        : t('history.sinceWithAge', { date, age })
  }
  const names = allNames ? facts.previousNames : facts.previousNames.slice(0, NAMES_SHOWN)
  const label = 'w-[136px] shrink-0 text-xs text-[var(--text-dim)]'
  return (
    <div className="flex flex-col gap-[var(--space-1)]" data-history-facts={facts.platform}>
      {showsPlatform && (
        <div className="flex">
          <PlatformPill platform={facts.platform} />
        </div>
      )}
      <dl className="flex flex-col gap-[var(--space-1)]">
        {since !== null && (
          <div className="flex items-baseline gap-[var(--space-3)]">
            <dt className={label}>{t('history.sinceLabel')}</dt>
            <dd className="min-w-0 flex-1 text-[13px] text-[var(--text)]">{since}</dd>
          </div>
        )}
        {/* From the instance log: the same three rows on both platforms. */}
        {met !== null && (
          <>
            <div className="flex items-baseline gap-[var(--space-3)]">
              <dt className={label}>{t('history.lastLabel')}</dt>
              <dd
                className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]"
                title={met.lastWorldName ?? undefined}
              >
                {lastWorld === ''
                  ? lastDate
                  : t('history.lastIn', { date: lastDate, world: lastWorld })}
              </dd>
            </div>
            <div className="flex items-baseline gap-[var(--space-3)]">
              <dt className={label}>{t('history.timesLabel')}</dt>
              <dd className="min-w-0 flex-1 text-[13px] tabular-nums text-[var(--text)]">
                {numberFormat.format(met.times)}
              </dd>
            </div>
            <div className="flex items-baseline gap-[var(--space-3)]">
              <dt className={label}>{t('history.togetherLabel')}</dt>
              <dd className="min-w-0 flex-1 text-[13px] text-[var(--text)]">
                {formatStay(met.togetherMs, asTranslate(t))}
              </dd>
            </div>
          </>
        )}
        {names.length > 0 && (
          <div className="flex items-baseline gap-[var(--space-3)]">
            <dt className={label}>{t('history.namesLabel')}</dt>
            <dd className="min-w-0 flex-1">
              <ul className="flex flex-col gap-[2px]">
                {names.map((change) => (
                  <li
                    key={`${change.until}-${change.name}`}
                    className="flex items-baseline gap-[var(--space-2)] text-[13px]"
                  >
                    <span className="min-w-0 truncate text-[var(--text)]" title={change.name}>
                      {change.name}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-dim)]">
                      {t('history.nameUntil', { date: dayFormat.format(new Date(change.until)) })}
                    </span>
                  </li>
                ))}
              </ul>
              {!allNames && facts.previousNames.length > NAMES_SHOWN && (
                <button
                  type="button"
                  onClick={() => setAllNames(true)}
                  className="mt-[var(--space-1)] rounded-control px-[var(--space-2)] py-[2px] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
                >
                  {t('history.showAllNames', { count: facts.previousNames.length })}
                </button>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
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

  // Friends since and earlier names. Read again when this person's friends
  // list entries change, so a new name shows while the dialog is open.
  const listChanges = (live ?? []).reduce(
    (newest, entry) =>
      FRIEND_LIST_KIND_SET.has(entry.kind) &&
      keys.has(friendKey(entry.platform, entry.platformUserId))
        ? Math.max(newest, entry.id)
        : newest,
    0
  )
  const facts = useQuery({
    queryKey: ['friend-history', ownerKey, listChanges],
    queryFn: () => fetchFriendHistory(friends),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: 'always'
  }).data
  const shownFacts = (facts ?? []).filter(
    (item) => item.since !== null || item.previousNames.length > 0 || item.met !== null
  )

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
      {shownFacts.length > 0 && (
        <section
          aria-label={t('history.factsAria')}
          className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]"
        >
          {shownFacts.map((item) => (
            <FriendFacts
              key={friendKey(item.platform, item.friendId)}
              facts={item}
              showsPlatform={showsPlatform}
              now={now.getTime()}
            />
          ))}
        </section>
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
