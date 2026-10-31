/**
 * Read-only community lookups: full profiles, search, Explore's New and
 * Recently updated lists, players online, and the user's own groups. Each
 * query is keyed by the signed-in account and runs only while its page or
 * panel shows; nothing refetches on a timer, window focus or reconnect. Main
 * caches every answer for 5 minutes, so these queries match that.
 */
import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  COMMUNITY_CACHE_MS,
  type CommunitySearchResult,
  type MyGroupsResult,
  type PlayersOnlineResult,
  type ProfileGroupsResult,
  type ProfileResult,
  type ProfileWorldsResult,
  type WorldList,
  type WorldListResult
} from '@shared/community'
import type { Platform } from '@shared/types'
import { useAvatarAccount } from './avatarLibrary'

type CommunityKind =
  | 'profile'
  | 'profile-worlds'
  | 'profile-groups'
  | 'community-search'
  | 'world-list'
  | 'players-online'
  | 'my-groups'

const KINDS: readonly CommunityKind[] = [
  'profile',
  'profile-worlds',
  'profile-groups',
  'community-search',
  'world-list',
  'players-online',
  'my-groups'
]

/** Account-keyed, so an old account's answers can never show under a new one. */
export function communityQueryKey(
  kind: CommunityKind,
  platform: Platform,
  accountId: string | null,
  detail: string = ''
): readonly [CommunityKind, Platform, string | null, string] {
  return [kind, platform, accountId, detail] as const
}

/** Every community entry of one platform, any account (cleared at an identity boundary). */
export function communityQueryKeysForPlatform(
  platform: Platform
): ReadonlyArray<readonly [CommunityKind, Platform]> {
  return KINDS.map((kind) => [kind, platform] as const)
}

function bridge(): NonNullable<Window['vrx']> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx
}

const READ_OPTIONS = {
  staleTime: COMMUNITY_CACHE_MS,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  // A typed failure is data (`ok: false`), not a thrown error; never retry alone.
  retry: false,
  networkMode: 'always'
} as const

/** A person's full profile, read once when their profile opens. */
export function useProfile(
  platform: Platform,
  userId: string | null
): UseQueryResult<ProfileResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('profile', platform, accountId, userId ?? ''),
    queryFn: () => bridge().getProfile({ platform, userId: userId! }),
    enabled: accountId !== null && userId !== null,
    ...READ_OPTIONS
  })
}

/** Their public worlds, read only after the user asks to see them. */
export function useProfileWorlds(
  platform: Platform,
  userId: string | null,
  enabled: boolean
): UseQueryResult<ProfileWorldsResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('profile-worlds', platform, accountId, userId ?? ''),
    queryFn: () => bridge().getProfileWorlds({ platform, userId: userId! }),
    enabled: enabled && accountId !== null && userId !== null,
    ...READ_OPTIONS
  })
}

/** Their groups, read only after the user asks to see them. */
export function useProfileGroups(
  platform: Platform,
  userId: string | null,
  enabled: boolean
): UseQueryResult<ProfileGroupsResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('profile-groups', platform, accountId, userId ?? ''),
    queryFn: () => bridge().getProfileGroups({ platform, userId: userId! }),
    enabled: enabled && accountId !== null && userId !== null,
    ...READ_OPTIONS
  })
}

/** People and worlds for a submitted search. `query` is null until Enter. */
export function useCommunitySearch(
  platform: Platform,
  query: string | null,
  enabled: boolean
): UseQueryResult<CommunitySearchResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('community-search', platform, accountId, query?.toLowerCase()),
    queryFn: () => bridge().searchCommunity({ platform, query: query! }),
    enabled: enabled && accountId !== null && query !== null,
    ...READ_OPTIONS,
    // World references expire in main after 5 minutes; a shorter life keeps
    // the cards openable.
    staleTime: 2 * 60_000
  })
}

/** Explore's New or Recently updated list, read when its tab opens. */
export function useWorldList(
  platform: Platform,
  list: WorldList,
  enabled: boolean
): UseQueryResult<WorldListResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('world-list', platform, accountId, list),
    queryFn: () => bridge().getWorldList({ platform, list }),
    enabled: enabled && accountId !== null,
    ...READ_OPTIONS,
    staleTime: 2 * 60_000
  })
}

/**
 * A Refresh press for the New or Recently updated list. Main re-reads at most
 * once every 30 s and otherwise answers from its cache. The answer lands in
 * the cache only under the account it was asked for.
 */
export function useRefreshWorldList(): (platform: Platform, list: WorldList) => Promise<void> {
  const refresh = useCommunityRefresh()
  return useCallback(
    (platform: Platform, list: WorldList) =>
      refresh('world-list', platform, list, () =>
        bridge().getWorldList({ platform, list, refresh: true })
      ),
    [refresh]
  )
}

/** Everyone playing the platform now, for the Dashboard. */
export function usePlayersOnline(
  platform: Platform,
  enabled: boolean
): UseQueryResult<PlayersOnlineResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('players-online', platform, accountId),
    queryFn: () => bridge().getPlayersOnline({ platform }),
    enabled: enabled && accountId !== null,
    ...READ_OPTIONS
  })
}

/** The signed-in user's groups, read when the Groups page opens. */
export function useMyGroups(
  platform: Platform,
  enabled: boolean
): UseQueryResult<MyGroupsResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: communityQueryKey('my-groups', platform, accountId),
    queryFn: () => bridge().getMyGroups({ platform }),
    enabled: enabled && accountId !== null,
    ...READ_OPTIONS
  })
}

/** A Refresh press on the Groups page, like `useRefreshWorldList`. */
export function useRefreshMyGroups(): (platform: Platform) => Promise<void> {
  const refresh = useCommunityRefresh()
  return useCallback(
    (platform: Platform) =>
      refresh('my-groups', platform, '', () => bridge().getMyGroups({ platform, refresh: true })),
    [refresh]
  )
}

function useCommunityRefresh(): (
  kind: CommunityKind,
  platform: Platform,
  detail: string,
  read: () => Promise<unknown>
) => Promise<void> {
  const client = useQueryClient()
  const vrchat = useAvatarAccount('vrchat')
  const chilloutvr = useAvatarAccount('chilloutvr')
  return useCallback(
    async (kind, platform, detail, read) => {
      const accountId = platform === 'vrchat' ? vrchat : chilloutvr
      if (accountId === null) return
      const key = communityQueryKey(kind, platform, accountId, detail)
      await client.cancelQueries({ queryKey: key, exact: true })
      const result = await read()
      client.setQueryData(key, result)
    },
    [client, vrchat, chilloutvr]
  )
}
