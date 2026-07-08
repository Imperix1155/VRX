import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Friend, Platform } from '@shared/types'
import { FRIENDS_RECONCILE_MS } from '@shared/constants'
import type { PlatformFilter } from '../stores/friends'

/** Per-platform query key for the friends list. */
export function friendsQueryKey(platform: Platform): readonly ['friends', Platform] {
  return ['friends', platform] as const
}

/**
 * Fetch the friend list over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the old store. Exported (pure) for unit tests.
 */
export async function fetchFriends(platform: Platform): Promise<Friend[]> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
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

/**
 * Map a `PlatformFilter` to the per-platform items in scope (VRX-66) — the ONE
 * definition of "which platforms does this filter select", shared by every
 * social surface so they all filter identically (Friends, Dashboard, the online
 * count, …). Generic over the item so callers can scope query results OR any
 * per-platform value. Order is VRChat-then-ChilloutVR for the combined `all`.
 */
export function scopeByPlatformFilter<T>(filter: PlatformFilter, vrc: T, cvr: T): T[] {
  return filter === 'vrchat' ? [vrc] : filter === 'chilloutvr' ? [cvr] : [vrc, cvr]
}

/** The subset of a friends query the list view consumes. */
export type FriendQuery = Pick<
  UseQueryResult<Friend[], Error>,
  'data' | 'isPending' | 'isError' | 'isFetching' | 'refetch'
>

export interface CombinedFriendsView {
  friends: Friend[] | undefined
  isPending: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => void
}

/**
 * Fold the two per-platform friends queries into one view according to the
 * platform filter (VRX-66). Single-platform filters pass that query's state
 * through unchanged (preserving the pre-VRX-66 behavior); `all` concatenates
 * VRChat-then-ChilloutVR in adapter order — a deliberate simple default, with
 * presence-based sectioning deferred to VRX-67.
 *
 * `friends` stays `undefined` until at least one scoped query returns, so the
 * list never flashes "empty" or an error while data is still loading (matching
 * the stale-while-revalidate render in FriendsList). Error/empty only surface
 * once every scoped query has resolved with nothing.
 */
export function combineFriendQueries(
  filter: PlatformFilter,
  vrc: FriendQuery,
  cvr: FriendQuery
): CombinedFriendsView {
  const scoped = scopeByPlatformFilter(filter, vrc, cvr)
  const anyData = scoped.some((q) => q.data !== undefined)
  return {
    friends: anyData ? scoped.flatMap((q) => q.data ?? []) : undefined,
    isPending: scoped.every((q) => q.isPending),
    isError: scoped.every((q) => q.isError),
    isFetching: scoped.some((q) => q.isFetching),
    refetch: () => {
      for (const q of scoped) void q.refetch()
    }
  }
}
