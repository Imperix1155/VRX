import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AuthStatus, Platform } from '@shared/types'

/** Per-platform query key for auth status (mirrors `friendsQueryKey`, VRX-37). */
export function authStatusQueryKey(platform: Platform): readonly ['auth-status', Platform] {
  return ['auth-status', platform] as const
}

/** How often an `error` auth status is re-checked (see useAuthStatus). */
export const AUTH_ERROR_RECHECK_MS = 60_000

/**
 * Fetch auth status over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the friends query pattern.
 */
export async function fetchAuthStatus(platform: Platform): Promise<AuthStatus> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx.getAuthStatus({ platform })
}

/**
 * Auth status query (VRX-158). Drives the auth gate in App.tsx. Extended (VRX-37)
 * to take a platform param — the Accounts settings page uses it for ChilloutVR.
 *
 * - Auth is invalidation-driven (on login success), not polled: polling would
 *   hammer the unofficial API and risk rate-limiting/account flags. The only
 *   interval is the slow re-check of an `error` status below.
 * - staleTime: 30_000 so observer MOUNTS do not refetch /auth/user within the
 *   window. Freshness is still invalidation-driven: login/verify-2fa/logout and
 *   the auth-invalidated event all explicitly invalidate this key, which bypasses
 *   staleTime. The 30s window only suppresses mount-driven refetch bursts when
 *   tabs are flipped (2026-07 audit OP-A3).
 */
export function useAuthStatus(platform: Platform): UseQueryResult<AuthStatus, Error> {
  return useQuery({
    queryKey: authStatusQueryKey(platform),
    queryFn: () => fetchAuthStatus(platform),
    staleTime: 30_000,
    // The one exception to "not polled": an `error` status (the check could not
    // reach the platform, e.g. VRX started offline or during an outage) is
    // re-checked once a minute. Until a check succeeds, a restored session never
    // becomes usable and the friends list fails without ever reaching the network.
    refetchInterval: (query) =>
      query.state.data?.state === 'error' ? AUTH_ERROR_RECHECK_MS : false,
    // Recovery surfaces mount after failure; mounting them must not restart
    // the initial check and send App back through its pending gate.
    retryOnMount: false,
    // A local IPC read: main decides reachability. Pausing it while the OS
    // reports offline left sign-in and sign-out results off screen.
    networkMode: 'always'
  })
}
