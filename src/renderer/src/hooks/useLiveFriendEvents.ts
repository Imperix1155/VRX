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
 *   on-(re)connect REST reconcile the issue requires.
 * - CVR presence-snapshot → buffered per platform and re-applied when the roster
 *   fetch resolves, so a snapshot that BEATS the slower REST roster isn't dropped
 *   (would leave every CVR friend offline). Buffer is cleared on any connection
 *   drop so a stale snapshot can't be re-applied over a reconcile while blind.
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

    // Buffer the latest FULL presence-snapshot per platform. CVR pushes it on WS
    // connect, which races — and usually beats — the slower REST roster fetch; a
    // snapshot that lands before the roster is cached would be dropped, leaving
    // every friend offline. We re-apply the buffer whenever that platform's
    // roster fetch succeeds (initial load or reconcile).
    const latestSnapshot = new Map<
      Friend['platform'],
      Extract<Parameters<typeof applyFriendEvent>[1], { type: 'presence-snapshot' }>
    >()

    const applyToCache = (
      platform: Friend['platform'],
      event: Parameters<typeof applyFriendEvent>[1]
    ): void => {
      queryClient.setQueryData<Friend[]>(friendsQueryKey(platform), (cached) =>
        cached === undefined ? undefined : applyFriendEvent(cached, event)
      )
    }

    const unsubscribe = window.vrx.onFriendEvent((event) => {
      if (event.type === 'connection') {
        // ANY connection-state change invalidates the buffered snapshot:
        // - on a drop (down/reconnecting/…) it's now STALE and must NOT be
        //   re-applied over the periodic REST reconcile — that would resurrect
        //   in-game presence for friends who may have gone offline while the WS
        //   was blind, and hide real offline transitions (Codex, 2026-07-08);
        // - on 'live' a fresh ONLINE_FRIENDS snapshot repopulates it right after,
        //   and (order: 'live' fires on socket-open, before the first message)
        //   clearing here can't wipe that fresh snapshot.
        latestSnapshot.delete(event.platform)
        if (event.health === 'live') {
          // Reconnected: reconcile the roster via REST — one refetch catches
          // everything missed while the socket was down.
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
      if (event.type === 'presence-snapshot') latestSnapshot.set(event.platform, event)
      applyToCache(event.platform, event)
    })

    // Re-apply the buffered snapshot after a roster FETCH resolves (the fix for
    // the snapshot-beats-roster race). Gated to non-manual 'success' actions so
    // our own setQueryData writes — which also dispatch 'success' (manual:true) —
    // can't retrigger this and loop.
    const unsubscribeCache = queryClient.getQueryCache().subscribe((cacheEvent) => {
      if (cacheEvent.type !== 'updated') return
      const action = cacheEvent.action
      if (action.type !== 'success' || action.manual) return
      // TanStack types the notify-event's query with `any` generics, so queryKey
      // widens to `any` — pin it back to the real QueryKey shape.
      const key = cacheEvent.query.queryKey as readonly unknown[]
      if (key[0] !== 'friends') return
      const platform = key[1] as Friend['platform']
      const snapshot = latestSnapshot.get(platform)
      const roster = cacheEvent.query.state.data as Friend[] | undefined
      if (snapshot === undefined || roster === undefined) return
      applyToCache(platform, snapshot)
    })

    return () => {
      unsubscribe()
      unsubscribeCache()
    }
  }, [queryClient])
}
