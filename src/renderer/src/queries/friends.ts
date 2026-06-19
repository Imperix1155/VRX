import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Friend, Platform } from '@shared/types'
import { FRIENDS_RECONCILE_MS } from '@shared/constants'

/** Per-platform query key for the friends list. */
export function friendsQueryKey(platform: Platform): readonly ['friends', Platform] {
  return ['friends', platform] as const
}

/**
 * Fetch the friend list over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the old store. Exported (pure) for unit tests.
 */
export async function fetchFriends(platform: Platform): Promise<Friend[]> {
  if (!window.vrx) throw new Error('bridge_unavailable')
  return window.vrx.getFriends({ platform })
}

/**
 * Friends query (VRX-22). The TanStack Query cache is the single source of truth
 * for server-side friends data (the Zustand store holds only view state).
 *
 * - Initial load on mount + a slow reconcile (`refetchInterval`); the WS is the
 *   live path, so this is a safety-net cadence, not a poll.
 * - Stale-while-revalidate: a failed background refetch keeps the last good
 *   `data` and surfaces `error` separately — never blanks data on error.
 */
export function useFriends(platform: Platform): UseQueryResult<Friend[], Error> {
  return useQuery({
    queryKey: friendsQueryKey(platform),
    queryFn: () => fetchFriends(platform),
    staleTime: FRIENDS_RECONCILE_MS,
    refetchInterval: FRIENDS_RECONCILE_MS
  })
}
