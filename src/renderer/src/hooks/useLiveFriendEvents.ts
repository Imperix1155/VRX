/**
 * Live friend-event subscription (VRX-146).
 *
 * Bridges the main process's 'friend-event' push channel into the TanStack
 * Query cache — the cache stays the single source of truth (VRX-22); this hook
 * just keeps it fresh in real time instead of waiting for the slow reconcile.
 *
 * - Friend deltas → applyFriendEvent over the cached list for that platform.
 *   Events arriving before the first fetch (no cached list yet) are dropped —
 *   the in-flight/upcoming fetch supersedes them.
 * - connection 'live' → invalidate the friends queries: the refetch IS the
 *   on-(re)connect REST reconcile the issue requires (anything missed while
 *   disconnected is caught by one paginated fetch).
 *
 * Mount ONCE for the authenticated app (App.tsx). Guards `window.vrx` absence
 * (Preview/tests) like every bridge consumer.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { friendsQueryKey } from '../queries/friends'
import { applyFriendEvent } from '../utils/applyFriendEvent'

export function useLiveFriendEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx?.onFriendEvent) return

    return window.vrx.onFriendEvent((event) => {
      if (event.type === 'connection') {
        // (Re)connected: reconcile via REST — one refetch catches everything
        // missed while the socket was down. Other healths need no cache action.
        if (event.health === 'live') {
          void queryClient.invalidateQueries({ queryKey: friendsQueryKey(event.platform) })
        }
        return
      }
      if (event.type === 'roster-changed') {
        // The friend ROSTER changed (adds/removes — CVR, VRX-147): the wire is
        // trigger-only, so refetch the list rather than patching the cache.
        void queryClient.invalidateQueries({ queryKey: friendsQueryKey(event.platform) })
        return
      }

      queryClient.setQueryData<Friend[]>(friendsQueryKey(event.platform), (cached) =>
        cached === undefined ? undefined : applyFriendEvent(cached, event)
      )
    })
  }, [queryClient])
}
