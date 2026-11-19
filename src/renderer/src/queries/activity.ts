import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import {
  matchesActivityFilter,
  type ActivityEntry,
  type ActivityFilter,
  type ActivityFriendRef,
  type ActivityPage,
  type ActivityPageRequest,
  type FriendHistoryFacts
} from '@shared/activity'
import type { Platform } from '@shared/types'
import { queryClient } from './queryClient'

/** Not persisted in the renderer: only the `friends` namespace survives a
 *  restart here (cache.ts). Main saves activity itself. */
export const activityKey = ['activity'] as const

/** One page of older saved activity, or of one friend's, straight from main.
 *  Local only: it reads this computer's history, never a platform. */
export async function fetchActivityPage(request: ActivityPageRequest): Promise<ActivityPage> {
  if (typeof window.vrx?.getActivityPage !== 'function') return { entries: [], hasMore: false }
  return window.vrx.getActivityPage(request)
}

/** What VRX has saved about a friendship (friends since, earlier names), for
 *  one friend or a linked person's two accounts. Local only. */
export async function fetchFriendHistory(
  friends: ActivityFriendRef[]
): Promise<FriendHistoryFacts[]> {
  if (typeof window.vrx?.getFriendHistory !== 'function') return []
  return window.vrx.getFriendHistory({ friends })
}

/** The newest activity main keeps per platform, newest first. Main pushes a change
 *  notice; this query never polls and reading it makes no platform request. */
export function useActivity(): UseQueryResult<ActivityEntry[], Error> {
  return useQuery({
    queryKey: activityKey,
    queryFn: async () => {
      if (typeof window.vrx?.getActivity !== 'function') return []
      return window.vrx.getActivity()
    },
    staleTime: Infinity,
    retry: false,
    // Local IPC: never pause while the browser reports offline.
    networkMode: 'always',
    enabled: typeof window !== 'undefined' && typeof window.vrx?.getActivity === 'function'
  })
}

/** The same list for the Friends list's Recent order. It uses the shared
 *  client directly (like the favorites hooks) so the list renders without a
 *  provider, and reads nothing until `enabled`. */
export function useActivityForFriendsOrder(
  enabled: boolean
): UseQueryResult<ActivityEntry[], Error> {
  return useQuery(
    {
      queryKey: activityKey,
      queryFn: async () => {
        if (typeof window.vrx?.getActivity !== 'function') return []
        return window.vrx.getActivity()
      },
      staleTime: Infinity,
      retry: false,
      networkMode: 'always',
      enabled:
        enabled && typeof window !== 'undefined' && typeof window.vrx?.getActivity === 'function'
    },
    queryClient
  )
}

/** Change pushes re-read the list. An account change drops that platform's
 *  entries at once, before main's coalesced notice arrives. */
export function subscribeActivity(client: QueryClient): () => void {
  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: activityKey })
    // The same notice covers the instance log (a view that is open reads again).
    void client.invalidateQueries({ queryKey: ['instance-log'] })
    void client.invalidateQueries({ queryKey: ['friend-history'] })
  }
  const changed = window.vrx?.onActivityChanged?.(invalidate)
  const boundary = window.vrx?.onIdentityBoundary?.(({ platform }) => {
    void client.cancelQueries({ queryKey: activityKey })
    client.setQueryData<ActivityEntry[]>(activityKey, (entries) =>
      entries?.filter((entry) => entry.platform !== platform)
    )
    invalidate()
  })
  return () => {
    changed?.()
    boundary?.()
  }
}

/** Mounted once by App, like the other app-wide pushes. */
export function useActivityEvents(): void {
  const client = useQueryClient()
  useEffect(() => subscribeActivity(client), [client])
}

/** What Clear takes away: the platforms in the filter and the shown kind. */
export interface ActivityClearScope {
  platforms: Platform[]
  filter: ActivityFilter
}

/** Clear what the page shows in main, and drop it here at once; the change
 *  push refreshes every view. Entries outside the scope stay. */
export async function clearActivity(client: QueryClient, scope: ActivityClearScope): Promise<void> {
  if (typeof window.vrx?.clearActivity !== 'function') return
  await window.vrx.clearActivity({ platforms: scope.platforms, filter: scope.filter })
  client.setQueryData<ActivityEntry[]>(activityKey, (entries) =>
    entries?.filter(
      (entry) =>
        !scope.platforms.includes(entry.platform) ||
        !matchesActivityFilter(entry.kind, scope.filter)
    )
  )
}
