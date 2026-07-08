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
 * - auth-invalidated (a data-path 401 on either platform, VRX-195/197) → the
 *   platform is QUARANTINED: its roster is forced to [], any in-flight fetch is
 *   cancelled, auth-status is re-checked, and every subsequent live/refetch event
 *   for it is dropped (roster kept []) so a stale/unauthorized roster never
 *   survives the auth boundary. Quarantine lifts ONLY on a successful
 *   authenticated auth-status — NOT on connection:'live' (socket-open isn't proof
 *   of re-auth); a fresh 'live' while quarantined re-verifies auth instead.
 *
 * Mount ONCE for the authenticated app (App.tsx). Guards `window.vrx` absence
 * (Preview/tests) like every bridge consumer.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { friendsQueryKey } from '../queries/friends'
import { authStatusQueryKey } from '../queries/auth'
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

    // Platforms whose session died (auth-invalidated) — we IGNORE all live data
    // for them until an authenticated `auth-status` confirms re-auth (NOT
    // `connection:'live'`, which fires on socket-open and isn't proof of auth).
    // Without this, a late event from the still-open dead socket (clearSession
    // doesn't close it) could refill the buffer / patch the cache AFTER we cleared
    // it, and re-apply stale presence onto the next roster fetch (Codex, 2026-07-08).
    const quarantined = new Set<Friend['platform']>()

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
          if (quarantined.has(event.platform)) {
            // Quarantined (dead session): re-VERIFY auth ONLY — do NOT refetch
            // friends. 'live' fires on socket OPEN, and an in-flight reconnect can
            // open with a STALE token before the server rejects it, so socket-open
            // is NOT proof of re-auth (Codex). Invalidating friends here would wake
            // the `useFriends` observer → hit the still-dead session → 401 →
            // auth-invalidated churn (CodeRabbit). The friends refetch happens only
            // once an authenticated auth-status LIFTS the quarantine (in the cache
            // subscriber below) — the single trusted release boundary.
            void queryClient.invalidateQueries({ queryKey: authStatusQueryKey(event.platform) })
          } else {
            // Normal reconnect — reconcile the roster via REST (one refetch catches
            // everything missed while the WS was blind).
            void queryClient.invalidateQueries({ queryKey: friendsQueryKey(event.platform) })
          }
        }
        return
      }
      if (event.type === 'auth-invalidated') {
        // The adapter cleared/distrusts this platform's session out of band (a
        // data-path 401, VRX-195). Two things: (1) re-check auth so a stale
        // "connected" account card flips to reconnect / 2FA; (2) DROP this
        // platform's now-unauthorized social data — the buffered snapshot and
        // the cached roster — so the friends list / dashboard don't keep showing
        // a stale roster across the auth boundary (Codex, 2026-07-08). Set the
        // roster to [] rather than removing the query, so a mounted observer
        // doesn't immediately refetch (→ another 401 → loop); a real reconnect
        // repopulates it.
        quarantined.add(event.platform)
        latestSnapshot.delete(event.platform)
        // Cancel any in-flight friends fetch so it can't resolve and write a
        // stale roster back after we clear (the cache subscriber above is the
        // backstop for one that still lands). Then clear the roster to [].
        void queryClient.cancelQueries({ queryKey: friendsQueryKey(event.platform) })
        queryClient.setQueryData<Friend[]>(friendsQueryKey(event.platform), [])
        void queryClient.invalidateQueries({ queryKey: authStatusQueryKey(event.platform) })
        return
      }
      // From here down, every event either mutates the roster (presence-snapshot,
      // deltas) or REFETCHES it (roster-changed) — drop them ALL for a quarantined
      // (dead-session) platform until it re-authenticates. A lingering dead socket
      // can emit any of them; a roster-changed that slipped past would invalidate →
      // refetch → 401 → error-churn loop, and a delta would resurrect stale data
      // (Codex, 2026-07-08). The guard MUST sit above roster-changed, not below.
      if (quarantined.has(event.platform)) return
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
    // the snapshot-beats-roster race), and lift the quarantine on an authenticated
    // auth-status. The FRIENDS re-apply is gated to non-manual 'success' actions so
    // our own setQueryData writes — which also dispatch 'success' (manual:true) —
    // can't retrigger it and loop; the auth-status lift runs above that gate.
    const unsubscribeCache = queryClient.getQueryCache().subscribe((cacheEvent) => {
      if (cacheEvent.type !== 'updated') return
      const action = cacheEvent.action
      if (action.type !== 'success') return
      // TanStack types the notify-event's query with `any` generics, so queryKey
      // widens to `any` — pin it back to the real QueryKey shape.
      const key = cacheEvent.query.queryKey as readonly unknown[]
      const platform = key[1] as Friend['platform']
      // Re-auth lifts the quarantine even if the WS hasn't gone 'live' yet (the
      // old dead socket can linger, so 'live' may be delayed) — a successful
      // AUTHENTICATED auth-status is the trusted boundary. Refetch friends so the
      // real roster lands instead of staying stuck empty (Codex, 2026-07-08).
      // Handled ABOVE the manual guard, and lifts on a MANUAL write too: the login
      // flow uses invalidateQueries today (a non-manual refetch), but honoring a
      // setQueryData({authenticated}) as well means a re-login can never leave a
      // platform stuck quarantined regardless of HOW it writes auth-status (Codex,
      // 2026-07-08). auth-status is never setQueryData'd by THIS hook, so there's
      // no re-apply loop to guard against here.
      if (key[0] === 'auth-status') {
        const status = cacheEvent.query.state.data as { state?: string } | undefined
        if (status?.state === 'authenticated' && quarantined.delete(platform)) {
          void queryClient.invalidateQueries({ queryKey: friendsQueryKey(platform) })
        }
        return
      }
      // Everything below re-applies buffered snapshots / enforces the quarantine
      // invariant over the FRIENDS cache — it must ignore our OWN setQueryData
      // writes (which dispatch 'success' with manual:true) or it recurses/loops.
      if (action.manual) return
      if (key[0] !== 'friends') return
      // Quarantine invariant (Codex): while a platform's session is dead, its
      // roster MUST stay []. A friends fetch can still succeed after we cleared
      // it — an in-flight request that started before the 401, or a refetch that
      // briefly succeeded — and would write a stale/unauthorized roster back.
      // Force it empty until the quarantine lifts (an authenticated auth-status).
      if (quarantined.has(platform)) {
        queryClient.setQueryData<Friend[]>(friendsQueryKey(platform), [])
        return
      }
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
