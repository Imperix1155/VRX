/**
 * Groups page (owner, 2026-10-31). The groups the user belongs to on VRChat
 * and ChilloutVR, in one grid sorted by name so neither platform leads. A
 * group opens a sheet with its code, member count, the user's role and its
 * description. View only: nothing here joins, leaves or changes a group. Data
 * loads when the page opens and on Refresh, never on a timer.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityGroup, MyGroupsResult } from '@shared/community'
import type { Platform } from '@shared/types'
import { useAuthStatus } from '../queries/auth'
import { useMyGroups, useRefreshMyGroups } from '../queries/community'
import { useFriendsStore } from '../stores/friends'
import { communitySource, platformName } from '../utils/community'
import CommunitySheet from './CommunitySheet'
import { CommunityHeading, CommunityNotices, CommunityTile, TileGrid } from './CommunityParts'

type ReadyGroups = Extract<MyGroupsResult, { ok: true }>

const ROLE_KEYS: Record<NonNullable<CommunityGroup['role']>, string> = {
  owner: 'groups.role.owner',
  member: 'groups.role.member'
}

export default function GroupsView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const showVrc = platformFilter !== 'chilloutvr'
  const showCvr = platformFilter !== 'vrchat'
  const vrcAuth = useAuthStatus('vrchat')
  const cvrAuth = useAuthStatus('chilloutvr')
  const vrc = useMyGroups('vrchat', showVrc)
  const cvr = useMyGroups('chilloutvr', showCvr)
  const queries: Record<Platform, typeof vrc> = { vrchat: vrc, chilloutvr: cvr }
  const sources = [
    ...(showVrc ? [{ platform: 'vrchat' as const, state: communitySource(vrcAuth, vrc) }] : []),
    ...(showCvr ? [{ platform: 'chilloutvr' as const, state: communitySource(cvrAuth, cvr) }] : [])
  ]
  const noticed = sources.filter(
    ({ state }) => platformFilter !== 'all' || state.kind !== 'not-connected'
  )
  const vrcReady: ReadyGroups | null = showVrc && vrc.data?.ok ? vrc.data : null
  const cvrReady: ReadyGroups | null = showCvr && cvr.data?.ok ? cvr.data : null
  const { groups, anyIncomplete, anyReady } = useMemo(() => {
    const ready = [vrcReady, cvrReady].filter((value): value is ReadyGroups => value !== null)
    const collator = new Intl.Collator(i18n.language, { sensitivity: 'base', numeric: true })
    return {
      groups: ready
        .flatMap((result) => result.groups)
        .sort((a, b) => collator.compare(a.name, b.name) || a.platform.localeCompare(b.platform)),
      anyIncomplete: ready.some((result) => !result.complete),
      anyReady: ready.length > 0
    }
  }, [vrcReady, cvrReady, i18n.language])

  const refreshGroups = useRefreshMyGroups()
  const [refreshing, setRefreshing] = useState(false)
  const refreshable = sources
    .filter(({ state }) => state.kind !== 'not-connected' && state.kind !== 'auth-pending')
    .map(({ platform }) => platform)
  const refresh = (): void => {
    setRefreshing(true)
    void Promise.allSettled(refreshable.map((platform) => refreshGroups(platform))).finally(() =>
      setRefreshing(false)
    )
  }
  const busy = refreshing || refreshable.some((platform) => queries[platform].isFetching)

  const [selected, setSelected] = useState<CommunityGroup | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    setSelected(null)
    if (opener?.isConnected) opener.focus()
    else topRef.current?.focus()
  }, [])
  const members = (group: CommunityGroup): string | null =>
    group.memberCount === null
      ? null
      : t('groups.members', {
          count: group.memberCount,
          formatted: new Intl.NumberFormat(i18n.language).format(group.memberCount)
        })

  return (
    <div>
      <div
        ref={topRef}
        tabIndex={-1}
        className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] focus:outline-none"
      >
        <p className="canvas-text text-sm text-[var(--text-dim)]">{t('groups.hint')}</p>
        <button
          type="button"
          onClick={refresh}
          disabled={busy || refreshable.length === 0}
          className="canvas-control shrink-0 rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] disabled:cursor-default disabled:opacity-60 motion-safe:transition-colors"
        >
          {busy ? t('groups.refreshing') : t('groups.refresh')}
        </button>
      </div>

      <CommunityNotices
        sources={noticed}
        onRetry={(platform) => void queries[platform].refetch()}
      />

      {anyReady ? (
        <section aria-label={t('groups.heading')}>
          <CommunityHeading>
            {t('groups.heading')}
            <span className="ml-[var(--space-2)] normal-case tracking-normal text-[var(--text-faint)]">
              {t('groups.count', { count: groups.length })}
            </span>
          </CommunityHeading>
          {groups.length === 0 ? (
            <p className="canvas-text text-sm text-[var(--text-dim)]">{t('groups.empty')}</p>
          ) : (
            <TileGrid min={220}>
              {groups.map((group) => (
                <CommunityTile
                  key={`${group.platform}:${group.groupId}`}
                  platform={group.platform}
                  title={group.name}
                  detail={
                    group.role === 'owner' ? t(ROLE_KEYS.owner) : (group.code ?? members(group))
                  }
                  imageUrl={group.imageUrl}
                  onOpen={(opener) => {
                    openerRef.current = opener
                    setSelected(group)
                  }}
                  ariaLabel={t('groups.openAria', {
                    name: group.name,
                    platform: platformName(t, group.platform)
                  })}
                />
              ))}
            </TileGrid>
          )}
          {anyIncomplete ? (
            <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">
              {t('groups.partial')}
            </p>
          ) : null}
        </section>
      ) : null}

      <CommunitySheet
        item={selected}
        itemKey={(group) => `${group.platform}:${group.groupId}`}
        header={(group) => ({
          platform: group.platform,
          title: group.name,
          imageUrl: group.bannerUrl ?? group.imageUrl,
          ariaLabel: t('groups.sheetAria', {
            name: group.name,
            platform: platformName(t, group.platform)
          }),
          tags: group.role === null ? [] : [t(ROLE_KEYS[group.role])]
        })}
        onClose={close}
      >
        {(group) => (
          <GroupDetails
            group={group}
            members={
              group.memberCount === null
                ? null
                : new Intl.NumberFormat(i18n.language).format(group.memberCount)
            }
          />
        )}
      </CommunitySheet>
    </div>
  )
}

function GroupDetails({
  group,
  members
}: {
  group: CommunityGroup
  members: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const notShown = t('profile.notShown')
  const facts: Array<[string, string]> = [
    ['groups.code', group.code ?? notShown],
    ['groups.memberCount', members ?? notShown],
    ['groups.yourRole', group.role === null ? notShown : t(ROLE_KEYS[group.role])]
  ]
  return (
    <div className="flex flex-col gap-[var(--space-4)] sm:flex-row sm:justify-between">
      <div className="min-w-0 flex-1">
        <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
          {t('groups.description')}
        </h3>
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-[var(--text)]">
          {group.description ?? t('groups.noDescription')}
        </p>
      </div>
      <div className="shrink-0 sm:w-[240px]">
        <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
          {t('groups.details')}
        </h3>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[13px]">
          {facts.map(([labelKey, value]) => (
            <div key={labelKey} className="contents">
              <dt className="text-[var(--text-dim)]">{t(labelKey)}</dt>
              <dd className="min-w-0 truncate text-[var(--text)]" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
