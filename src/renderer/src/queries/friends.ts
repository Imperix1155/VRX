import { useMemo } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { Friend, Platform } from '@shared/types'
import { RECONCILE_INTERVAL_MS } from '@shared/constants'
import type { PlatformFilter } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useAuthStatus } from './auth'
import { mergeKnownInstanceMetadata } from '../utils/mergeKnownInstanceMetadata'
import { withFriendEventReplay } from './friendEventReplay'

const RECONCILE_JITTER_FRACTION = 0.1

function jitteredReconcileInterval(intervalMs: number): number {
  const factor = 1 - RECONCILE_JITTER_FRACTION + Math.random() * RECONCILE_JITTER_FRACTION * 2
  return Math.round(intervalMs * factor)
}

/** Per-platform query key for the friends list. */
export function friendsQueryKey(platform: Platform): readonly ['friends', Platform] {
  return ['friends', platform] as const
}

/**
 * Fetch the friend list over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the old store. Exported (pure) for unit tests.
 */
export async function fetchFriends(
  platform: Platform,
  getCached?: () => Friend[] | undefined
): Promise<Friend[]> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  const result = await window.vrx.getFriends({ platform })
  if (Array.isArray(result)) return result
  const seen = new Set(result.friends.map((friend) => friend.platformUserId))
  // Read after the await: live updates and account-boundary cache clears win.
  const omitted = (getCached?.() ?? []).filter(
    (friend) => friend.platform === platform && !seen.has(friend.platformUserId)
  )
  return omitted.length ? [...result.friends, ...omitted] : result.friends
}

/**
 * Friends query (VRX-22). The TanStack Query cache is the single source of truth
 * for server-side friends data (the Zustand store holds only view state).
 *
 * - Initial load on mount + a slow reconcile (`refetchInterval`); the WS is the
 *   live path, so this is a safety-net cadence, not a poll. Manual cadence uses
 *   infinite staleness so time alone cannot reconcile on a later remount.
 * - Stale-while-revalidate: a failed background refetch keeps the last good
 *   `data` and surfaces `error` separately — never blanks data on error.
 */
export function useFriends(platform: Platform): UseQueryResult<Friend[], Error> {
  const reconcileInterval = useSettingsStore((s) => s.settings.reconcileInterval)
  const reconcileIntervalMs = RECONCILE_INTERVAL_MS[reconcileInterval]
  // Auth-gated: an unauthenticated platform must not fetch — otherwise every
  // mount/interval/cache-removal wakes a doomed request whose 401 re-broadcasts
  // auth-invalidated (observed end-to-end on logout, VRX-191 review round 2).
  // `error` DOES fetch (VRX-201): on API drift the session cookie is typically
  // still valid, so the fetch just works instead of hanging social views on an
  // indefinite isPending (disabled + no auth polling = never converges). No doom
  // loop on a genuinely dead session either: the fetch 401s, the adapter clears
  // the session (existing behavior), auth converges to `unauthenticated`, and
  // the query re-disables — the VRX-191 gating reason was unauthenticated loops.
  const auth = useAuthStatus(platform)
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: friendsQueryKey(platform),
    // Renderer-side sibling of VrcAdapter's enrichPipelineEvent clobber guard
    // (VRX-254), covering the REST roster path (VRX-258). The cache is read
    // AFTER the fetch resolves so any live world-metadata enrichment that lands
    // mid-flight survives the REST write.
    queryFn: (context) => {
      const load = async (): Promise<Friend[]> => {
        const fresh = await fetchFriends(platform, () =>
          queryClient.getQueryData(friendsQueryKey(platform))
        )
        return mergeKnownInstanceMetadata(
          queryClient.getQueryData(friendsQueryKey(platform)),
          fresh
        )
      }
      return platform === 'vrchat'
        ? withFriendEventReplay(queryClient, context.signal, load)
        : load()
    },
    staleTime: reconcileIntervalMs === false ? Infinity : reconcileIntervalMs,
    refetchInterval:
      reconcileIntervalMs === false ? false : () => jitteredReconcileInterval(reconcileIntervalMs),
    enabled: auth.data?.state === 'authenticated' || auth.data?.state === 'error'
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
> & {
  /** Query projections without enablement retain their existing enabled behavior. */
  isEnabled?: boolean
}

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
 * once every enabled scoped query has resolved with nothing. Disabled queries
 * do not hold loading/error recovery open and are skipped by explicit refresh.
 */
export function combineFriendQueries(
  filter: PlatformFilter,
  vrc: FriendQuery,
  cvr: FriendQuery
): CombinedFriendsView {
  const scoped = scopeByPlatformFilter(filter, vrc, cvr)
  const friends = scoped.some((q) => q.data !== undefined)
    ? scoped.flatMap((q) => q.data ?? [])
    : undefined
  return combinedView(scoped, friends)
}

/** Disabled queries can remain pending forever and refetch bypasses their gate. */
function combinedView(scoped: FriendQuery[], friends: Friend[] | undefined): CombinedFriendsView {
  const enabled = scoped.filter((q) => q.isEnabled !== false)
  const anyPending = enabled.some((q) => q.isPending)
  const errorMasksEmpty =
    !anyPending && (friends?.length ?? 0) === 0 && enabled.some((q) => q.isError)
  return {
    friends: errorMasksEmpty ? undefined : friends,
    isPending: friends === undefined && anyPending,
    isError: errorMasksEmpty || (enabled.length > 0 && enabled.every((q) => q.isError)),
    isFetching: enabled.some((q) => q.isFetching),
    refetch: () => {
      for (const q of enabled) void q.refetch()
    }
  }
}

/**
 * React hook wrapper for `combineFriendQueries` that memoizes the combined
 * `friends` array on the underlying stable data (`vrc.data`, `cvr.data`) and
 * the filter. This prevents `FriendsList`'s downstream `useMemo` (search /
 * section grouping) from re-running on every unrelated render when the query
 * layer was returning a fresh array each time (2026-07 audit OP-B1 fix).
 *
 * TanStack Query's structural sharing keeps `vrc.data`/`cvr.data` references
 * stable across no-change refetches, so memoizing on them is sound.
 */
export function useCombineFriendQueries(
  filter: PlatformFilter,
  vrc: FriendQuery,
  cvr: FriendQuery
): CombinedFriendsView {
  const friends = useMemo(() => {
    const scoped = scopeByPlatformFilter(filter, vrc.data, cvr.data)
    const anyData = scoped.some((d) => d !== undefined)
    if (!anyData) return undefined
    return scoped.flatMap((d) => d ?? [])
  }, [filter, vrc.data, cvr.data])

  return combinedView(scopeByPlatformFilter(filter, vrc, cvr), friends)
}
