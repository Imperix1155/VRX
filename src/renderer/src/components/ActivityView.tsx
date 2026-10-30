/**
 * Activity page (owner, 2026-10-27): friends coming online, joining a world,
 * and going offline, newest first, for both platforms in one list. Main keeps
 * the list in memory from the live sockets (`activityFeed.ts`); this page only
 * reads it, so opening it makes no platform request.
 *
 * Both platforms share one row layout. Each entry is a capsule tinted with its
 * platform's color (owner, 2026-10-27); the platform pill carries the platform
 * in words, never color alone. The TopBar's platform filter scopes the list;
 * the Show control here picks a kind and is saved like any other setting.
 * A row opens that friend's details on the Friends page.
 */
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ACTIVITY_FILTERS, type ActivityEntry, type ActivityFilter } from '@shared/activity'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import type { Friend } from '@shared/types'
import { clearActivity, useActivity } from '../queries/activity'
import { useFriends } from '../queries/friends'
import { useLinkedProfiles } from '../queries/linkedProfiles'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useProfileSelection } from '../stores/profileSelection'
import type { PlatformFilter } from '../stores/friends'
import type { ProfileTarget } from '../utils/projectLinkedFriends'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { stripInstanceSuffix } from '../utils/worldName'
import { Avatar } from './Avatar'
import PlatformPill from './PlatformPill'
import SegmentedControl from './SegmentedControl'

const FILTER_LABEL_KEYS: Record<ActivityFilter, string> = {
  all: 'activity.kinds.all',
  online: 'activity.kinds.online',
  world: 'activity.kinds.world',
  offline: 'activity.kinds.offline'
}

const graphemes = new Intl.Segmenter()

function initialOf(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.toUpperCase()
}

function friendKey(platform: Friend['platform'], platformUserId: string): string {
  return `${platform}\u0000${platformUserId}`
}

/** What happened, in words. World names drop ChilloutVR's "(#…)" instance tag. */
function describe(
  entry: ActivityEntry,
  t: (key: string, options?: Record<string, string>) => string
): string {
  const world = entry.worldName === null ? '' : stripInstanceSuffix(entry.worldName).trim()
  switch (entry.kind) {
    case 'online':
      return world === '' ? t('activity.online') : t('activity.onlineIn', { world })
    case 'world':
      return world === '' ? t('activity.joinedUnknown') : t('activity.joined', { world })
    case 'offline':
      return t('activity.offline')
  }
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
  const description = describe(entry, t)
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
      aria-label={`${name}, ${description}, ${time}. ${t('activity.openFriend', { name })}`}
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

  const entries = useMemo(
    () =>
      (activity.data ?? []).filter(
        (entry) =>
          (platformFilter === 'all' || entry.platform === platformFilter) &&
          (filter === 'all' || entry.kind === filter)
      ),
    [activity.data, platformFilter, filter]
  )
  const hasAnyInScope = (activity.data ?? []).some(
    (entry) => platformFilter === 'all' || entry.platform === platformFilter
  )

  const language = i18n.language
  const formats = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }),
      dayTime: new Intl.DateTimeFormat(language, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    }),
    [language]
  )
  const today = new Date().toDateString()

  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-dim)]">{t('activity.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <div className="glass glass-information flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
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
  if (activity.data === undefined) {
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
  } else if (entries.length === 0) {
    content = (
      <div className="glass glass-information flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
        {hasAnyInScope ? (
          <p className="text-sm font-semibold text-[var(--text-dim)]">
            {t('activity.filteredEmpty')}
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-[var(--text-dim)]">
              {t('activity.emptyHeading')}
            </p>
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
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
          const time = (at.toDateString() === today ? formats.time : formats.dayTime).format(at)
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
          values={ACTIVITY_FILTERS}
          active={filter}
          labelKeys={FILTER_LABEL_KEYS}
          ariaLabel={t('activity.filterAria')}
          onChange={(value) => updateSettings({ activityFilter: value })}
        />
        <button
          type="button"
          disabled={(activity.data ?? []).length === 0}
          onClick={() => {
            // A failed clear keeps the list as it is; the next push refreshes it.
            clearActivity(client).catch(() => undefined)
          }}
          aria-label={t('activity.clearAria')}
          className="canvas-text rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent motion-safe:transition-colors"
        >
          {t('activity.clear')}
        </button>
      </div>
      {content}
    </section>
  )
}
