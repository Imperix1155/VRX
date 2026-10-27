import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import type { ActivityEntry } from '@shared/activity'

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

/** Clear the list in main; the change push refreshes every view. */
export async function clearActivity(client: QueryClient): Promise<void> {
  if (typeof window.vrx?.clearActivity !== 'function') return
  await window.vrx.clearActivity()
  client.setQueryData<ActivityEntry[]>(activityKey, [])
}
