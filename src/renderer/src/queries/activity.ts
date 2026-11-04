import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import type { ActivityEntry, ActivityFilter } from '@shared/activity'
import type { Platform } from '@shared/types'
import { queryClient } from './queryClient'

/** Not persisted: only the `friends` namespace survives a restart (cache.ts). */
export const activityKey = ['activity'] as const

/** The in-memory activity list main keeps, newest first. Main pushes a change
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
        (scope.filter !== 'all' && entry.kind !== scope.filter)
    )
  )
}
