/**
 * Activity page (owner, 2026-10-27): friends coming online, joining a world,
 * and going offline, newest first, for both platforms in one list. Main keeps
 * the list in memory from the live sockets (`activityFeed.ts`); this page only
 * reads it, so opening it makes no platform request. Since 2026-11-15
 * (owner) main also saves the list on this computer, per account: Show older
 * reads further back a page at a time, Kept for sets how long it stays, and
 * Clear asks first when it would delete saved entries.
 *
 * Both platforms share one row layout. Each entry is a capsule tinted with its
 * platform's color (owner, 2026-10-27); the platform pill carries the platform
 * in words, never color alone. The TopBar's platform filter scopes the list;
 * the Show control here picks a kind and is saved like any other setting.
 * Clear forgets only what that scope shows. A row opens that friend's details
 * on the Friends page.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ACTIVITY_FILTERS,
  matchesActivityFilter,
  type ActivityEntry,
  type ActivityFilter
} from '@shared/activity'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM } from '@shared/constants'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import type { Friend, Platform } from '@shared/types'
import { asTranslate } from '../i18n/translate'
import { activityKey, clearActivity, useActivity } from '../queries/activity'
import { useAuthStatus } from '../queries/auth'
import { clearInstanceLog, useInstanceVisits } from '../queries/instanceLog'
import { useFriends } from '../queries/friends'
import { useLinkedProfiles } from '../queries/linkedProfiles'
import { useActivityPager } from '../hooks/useActivityPager'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useProfileSelection } from '../stores/profileSelection'
import type { PlatformFilter } from '../stores/friends'
import type { ProfileTarget } from '../utils/projectLinkedFriends'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { mergeActivity, olderThanList } from '../utils/activityPaging'
import {
  ACTIVITY_KEEP_LABEL_KEYS,
  activityTimeFormats,
  describeActivity,
  formatActivityTime
} from '../utils/activityText'
import { ActivityClearDialog, ActivityKeepDialog } from './ActivityDialogs'
import { Avatar } from './Avatar'
import PlatformPill from './PlatformPill'
import InstanceVisitList from './InstanceVisitList'
import SegmentedControl from './SegmentedControl'
import { initialOf } from '../utils/initialOf'

/** The page's tabs: the Activity list's kinds, then the instance log. */
const INSTANCES = 'instances'
type ActivityTab = ActivityFilter | typeof INSTANCES
const ACTIVITY_TABS: readonly ActivityTab[] = [...ACTIVITY_FILTERS, INSTANCES]
const FILTER_LABEL_KEYS: Record<ActivityTab, string> = {
  all: 'activity.kinds.all',
  online: 'activity.kinds.online',
  world: 'activity.kinds.world',
  offline: 'activity.kinds.offline',
  friends: 'activity.kinds.friends',
  instances: 'activity.kinds.instances'
}

function friendKey(platform: Friend['platform'], platformUserId: string): string {
  return `${platform}\u0000${platformUserId}`
}

/** The same target a Friends row for this account would carry: a linked
 *  person under All, otherwise the one account. */
function profileTargetFor(
  entry: ActivityEntry,
  links: LinkSnapshot | undefined,
  platformFilter: PlatformFilter
): ProfileTarget {
  const ref = { platform: entry.platform, friendId: entry.platformUserId }
  const person = links?.profiles.find((profile) =>
    profile.members.some(
      (member) =>
        member.platform === entry.platform &&
        member.friendId === entry.platformUserId &&
        links.accountIds[member.platform] === member.platformAccountId
    )
  )
  if (person === undefined) return { kind: 'account', account: ref, personId: null }
  return platformFilter === 'all'
    ? { kind: 'person', personId: person.id, anchor: ref }
    : { kind: 'account', account: ref, personId: person.id }
}

function ActivityRow({
  entry,
  friend,
  time,
  dateTime,
  onOpen
}: {
  entry: ActivityEntry
  friend: Friend | undefined
  time: string
  dateTime: string
  onOpen: (entry: ActivityEntry) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const description = describeActivity(entry, asTranslate(t))
  const name = friend?.displayName ?? entry.displayName
  const body = (
    <>
      <span aria-hidden="true" className="shrink-0">
        {friend === undefined ? (
          <span className="grid h-[24px] w-[24px] place-items-center rounded-full text-[10px] font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">
            {initialOf(entry.displayName)}
          </span>
        ) : (
          <Avatar friend={friend} variant="small" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--text)]" title={name}>
          {name}
        </span>
        {/* The full world name on hover, a "(#…)" tag included, like the hot
            cards (owner rule VRX-199). */}
        <span
          className="block truncate text-xs text-[var(--text-dim)]"
          title={entry.worldName ?? undefined}
        >
          {description}
        </span>
      </span>
      {/* One fixed column, and the pill fills it, so both platforms' pills are
          the same size and line up; the shorter word sits centered. */}
      <span className="flex w-[96px] shrink-0">
        <PlatformPill platform={entry.platform} className="w-full" />
      </span>
      <time
        dateTime={dateTime}
        className="w-[104px] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-[var(--text-dim)]"
      >
        {time}
      </time>
    </>
  )
  const rowClass =
    'flex w-full items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-left'
  if (friend === undefined) {
    // No longer on the friends list: nothing to open.
    return <div className={rowClass}>{body}</div>
  }
  return (
    <button
      type="button"
      className={`${rowClass} cursor-pointer rounded-control hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors`}
      aria-label={t('activity.rowAria', {
        name,
        platform: t(
          entry.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr'
        ),
        description,
        time
      })}
      onClick={() => onOpen(entry)}
    >
      {body}
    </button>
  )
}

export default function ActivityView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const activity = useActivity()
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const filter = useSettingsStore((s) => s.settings.activityFilter)
  const keepFor = useSettingsStore((s) => s.settings.activityKeepFor)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const links = useLinkedProfiles().data
  const openFriend = (entry: ActivityEntry): void => {
    useProfileSelection.getState().select(profileTargetFor(entry, links, platformFilter))
    useUiStore.getState().setActiveTab('friends')
  }
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)

  const vrcData = vrcFriends.data
  const cvrData = cvrFriends.data
  const friendsByKey = useMemo(() => {
    const byKey = new Map<string, Friend>()
    for (const friend of [...(vrcData ?? []), ...(cvrData ?? [])]) {
      byKey.set(friendKey(friend.platform, friend.platformUserId), friend)
    }
    return byKey
  }, [vrcData, cvrData])

  const live = activity.data
  const platforms = useMemo<Platform[]>(
    () => (platformFilter === 'all' ? ['vrchat', 'chilloutvr'] : [platformFilter]),
    [platformFilter]
  )

  // Saved activity belongs to an account, and main learns the account only
  // when the sign-in check answers, a few seconds after launch. Until the
  // list has been read after that, an empty list means "not read yet", never
  // "nothing saved": the page says it is loading instead of "No activity yet".
  const vrcAuth = useAuthStatus('vrchat')
  const cvrAuth = useAuthStatus('chilloutvr')
  const accountsPending = platforms.some((platform) => {
    const auth = platform === 'vrchat' ? vrcAuth : cvrAuth
    return auth.data === undefined && auth.isPending
  })
  const [readSinceAccounts, setReadSinceAccounts] = useState(!accountsPending)
  if (accountsPending && readSinceAccounts) setReadSinceAccounts(false)
  useEffect(() => {
    if (accountsPending || readSinceAccounts) return
    let current = true
    void client.refetchQueries({ queryKey: activityKey }).finally(() => {
      if (current) setReadSinceAccounts(true)
    })
    return () => {
      current = false
    }
  }, [accountsPending, readSinceAccounts, client])
  const listNotReadYet = accountsPending || !readSinceAccounts

  // Entries the list held while this page was open. Main keeps only the newest
  // per platform, so once older pages are shown, an entry that leaves the list
  // for a newer one would otherwise vanish from the middle of the page.
  const [carried, setCarried] = useState<ReadonlyMap<number, ActivityEntry>>(() => new Map())
  const [carriedFrom, setCarriedFrom] = useState<ActivityEntry[] | undefined>(undefined)
  if (live !== carriedFrom) {
    setCarriedFrom(live)
    if (live !== undefined && live.length > 0) {
      const next = new Map(carried)
      for (const entry of live) next.set(entry.id, entry)
      setCarried(next)
    }
  }

  // Older saved entries. They start over when the scope changes, after a
  // Clear or a restore, and when an account changes; a platform takes part only while the
  // list holds its full allowance (see `olderThanList`).
  const [restarts, setRestarts] = useState(0)
  const startOver = (): void => {
    setCarried(new Map())
    setRestarts((count) => count + 1)
  }
  useEffect(
    () =>
      window.vrx?.onIdentityBoundary?.(() => {
        setCarried(new Map())
        setRestarts((count) => count + 1)
      }),
    []
  )
  const olderStart = useMemo(
    () => olderThanList(live ?? [], platforms, ACTIVITY_MAX_ENTRIES_PER_PLATFORM),
    [live, platforms]
  )
  const knownIds = useMemo(() => new Set(carried.keys()), [carried])
  const pager = useActivityPager({
    restartKey: [
      live === undefined ? 'waiting' : 'ready',
      platformFilter,
      filter,
      keepFor === 'session' ? 'session' : 'saved',
      olderStart.map((cursor) => cursor.platform).join('+'),
      restarts
    ].join('|'),
    start: olderStart,
    filter,
    known: knownIds
  })

  const entries = useMemo(
    () =>
      mergeActivity(pager.entries, carried.values(), live ?? []).filter(
        (entry) =>
          (platformFilter === 'all' || entry.platform === platformFilter) &&
          matchesActivityFilter(entry.kind, filter)
      ),
    [pager.entries, carried, live, platformFilter, filter]
  )
  const hasAnyInScope =
    (live ?? []).some((entry) => platformFilter === 'all' || entry.platform === platformFilter) ||
    pager.canShowOlder
  // The instance log is its own list under the same header. Which list is
  // open is not saved: the page opens on the Activity list.
  const [showInstances, setShowInstances] = useState(false)
  const instanceVisits = useInstanceVisits(platforms, showInstances)
  const shownCount = showInstances ? instanceVisits.visits.length : entries.length
  const [keepOpen, setKeepOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const clearShown = (): void => {
    if (showInstances) {
      clearInstanceLog(client, platforms)
        .then(() => instanceVisits.startOver())
        .catch(() => undefined)
      return
    }
    // Drop what this page holds first, so nothing cleared is carried on.
    startOver()
    // Clear takes only what is on screen, like the Inbox's Hide all: the
    // filtered platforms and the shown kind, saved entries included. A failed
    // clear keeps the list as it is; the next push refreshes it.
    clearActivity(client, { platforms, filter }).catch(() => undefined)
  }

  const language = i18n.language
  const formats = useMemo(() => activityTimeFormats(language), [language])
  const now = new Date()

  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-dim)]">{t('activity.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <div className="glass glass-layer flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
        <p className="text-sm font-semibold text-[var(--text-dim)]">
          {selectedPlatform === null ? null : t(NOT_CONNECTED_KEY.activity[selectedPlatform])}
        </p>
        <button
          type="button"
          onClick={openAccounts}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
        >
          {t('activity.notConnected.openAccounts')}
        </button>
      </div>
    )
  }

  let content: React.JSX.Element
  if (showInstances) {
    if (!instanceVisits.ready) {
      content = instanceVisits.failed ? (
        <div className="flex items-center gap-[var(--space-3)]">
          <p className="text-sm text-[var(--error)]">{t('instances.error')}</p>
          <button
            type="button"
            onClick={instanceVisits.retry}
            className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
          >
            {t('activity.retry')}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-dim)]">{t('activity.loading')}</p>
      )
    } else if (instanceVisits.visits.length === 0) {
      content = (
        <div className="glass glass-layer flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
          <p className="text-sm font-semibold text-[var(--text-dim)]">
            {t('instances.emptyHeading')}
          </p>
          <p className="mt-[var(--space-1)] max-w-[52ch] text-balance text-xs text-[var(--text-dim)]">
            {t(keepFor === 'session' ? 'instances.sessionHint' : 'instances.emptyHint')}
          </p>
        </div>
      )
    } else {
      content = <InstanceVisitList visits={instanceVisits.visits} now={now} formats={formats} />
    }
  } else if (activity.data === undefined) {
    content = activity.isError ? (
      <div className="flex items-center gap-[var(--space-3)]">
        <p className="text-sm text-[var(--error)]">{t('activity.error')}</p>
        <button
          type="button"
          onClick={() => void activity.refetch()}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('activity.retry')}
        </button>
      </div>
    ) : (
      <p className="text-sm text-[var(--text-dim)]">{t('activity.loading')}</p>
    )
  } else if (entries.length === 0 && !pager.canShowOlder && listNotReadYet) {
    content = <p className="text-sm text-[var(--text-dim)]">{t('activity.loading')}</p>
  } else if (entries.length === 0 && !pager.canShowOlder) {
    content = (
      <div className="glass glass-layer flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
        {hasAnyInScope ? (
          <p className="text-sm font-semibold text-[var(--text-dim)]">
            {t('activity.filteredEmpty')}
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-[var(--text-dim)]">
              {t('activity.emptyHeading')}
            </p>
            <p className="mt-[var(--space-1)] max-w-[52ch] text-balance text-xs text-[var(--text-dim)]">
              {t('activity.emptyHint')}
            </p>
          </>
        )}
      </div>
    )
  } else {
    content = (
      <ol className="flex flex-col gap-[6px]">
        {entries.map((entry) => {
          const at = new Date(entry.at)
          const time = formatActivityTime(at, now, formats)
          return (
            <li key={entry.id} className={`platform-row platform-row--${entry.platform}`}>
              <ActivityRow
                entry={entry}
                friend={friendsByKey.get(friendKey(entry.platform, entry.platformUserId))}
                time={time}
                dateTime={at.toISOString()}
                onOpen={openFriend}
              />
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <section aria-label={t('shell.nav.activity')}>
      <div className="mb-[12px] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <SegmentedControl
          values={ACTIVITY_TABS}
          active={showInstances ? INSTANCES : filter}
          labelKeys={FILTER_LABEL_KEYS}
          ariaLabel={t('activity.filterAria')}
          onChange={(value) => {
            setShowInstances(value === INSTANCES)
            if (value !== INSTANCES) updateSettings({ activityFilter: value })
          }}
        />
        <div className="flex items-center gap-[var(--space-1)]">
          {/* How long activity stays saved: the choice in words, and the
              button that changes it (owner, 2026-11-15). */}
          <button
            type="button"
            onClick={() => setKeepOpen(true)}
            aria-label={t('activity.keep.buttonAria', {
              choice: t(ACTIVITY_KEEP_LABEL_KEYS[keepFor])
            })}
            className="canvas-text rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
          >
            {t('activity.keep.button', { choice: t(ACTIVITY_KEEP_LABEL_KEYS[keepFor]) })}
          </button>
          <button
            type="button"
            // Not `disabled`: once the list it cleared is empty, a disabled
            // button would drop keyboard focus to the page.
            aria-disabled={shownCount === 0}
            onClick={() => {
              if (shownCount === 0) return
              // Saved activity is deleted for good, so ask first. With nothing
              // saved, Clear acts at once as it always did.
              if (keepFor === 'session' && !showInstances) clearShown()
              else setClearOpen(true)
            }}
            aria-label={t(showInstances ? 'instances.clearAria' : 'activity.clearAria')}
            className="canvas-text rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent motion-safe:transition-colors"
          >
            {t('activity.clear')}
          </button>
        </div>
      </div>
      {content}
      {showInstances && (instanceVisits.canShowOlder || instanceVisits.olderFailed) && (
        <div className="mt-[var(--space-3)] flex items-center justify-center gap-[var(--space-3)]">
          {instanceVisits.olderFailed && (
            <p className="canvas-text text-xs text-[var(--text-dim)]">
              {t('activity.olderFailed')}
            </p>
          )}
          <button
            type="button"
            onClick={instanceVisits.olderFailed ? instanceVisits.retry : instanceVisits.showOlder}
            className="canvas-text rounded-control px-[var(--space-4)] py-[var(--space-2)] text-xs font-medium text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
          >
            {t(instanceVisits.olderFailed ? 'activity.retry' : 'activity.showOlder')}
          </button>
        </div>
      )}
      {!showInstances &&
        live !== undefined &&
        (pager.canShowOlder || pager.status === 'failed') && (
          <div className="mt-[var(--space-3)] flex items-center justify-center gap-[var(--space-3)]">
            {pager.status === 'failed' ? (
              <>
                <p className="canvas-text text-xs text-[var(--text-dim)]">
                  {t('activity.olderFailed')}
                </p>
                <button
                  type="button"
                  onClick={pager.retry}
                  className="canvas-text rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
                >
                  {t('activity.retry')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={pager.showOlder}
                className="canvas-text rounded-control px-[var(--space-4)] py-[var(--space-2)] text-xs font-medium text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:transition-colors"
              >
                {t('activity.showOlder')}
              </button>
            )}
          </div>
        )}
      {keepOpen && (
        <ActivityKeepDialog
          value={keepFor}
          onChange={(value) => updateSettings({ activityKeepFor: value })}
          onRestored={() => {
            // Everything saved was replaced: drop the rows and older pages
            // this page still holds from before.
            startOver()
            instanceVisits.startOver()
          }}
          onClose={() => setKeepOpen(false)}
        />
      )}
      {clearOpen && (
        <ActivityClearDialog
          body={showInstances ? t('instances.clearBody') : undefined}
          onConfirm={clearShown}
          onClose={() => setClearOpen(false)}
        />
      )}
    </section>
  )
}
