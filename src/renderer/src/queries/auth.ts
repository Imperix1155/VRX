import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AuthStatus, Platform } from '@shared/types'

/** Per-platform query key for auth status (mirrors `friendsQueryKey`, VRX-37). */
export function authStatusQueryKey(
  platform: Platform = 'vrchat'
): readonly ['auth-status', Platform] {
  return ['auth-status', platform] as const
}

/**
 * Fetch auth status over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the friends query pattern.
 */
export async function fetchAuthStatus(platform: Platform = 'vrchat'): Promise<AuthStatus> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx.getAuthStatus({ platform })
}

/**
 * Auth status query (VRX-158). Drives the auth gate in App.tsx. Extended (VRX-37)
 * to take a platform param — the Accounts settings page uses it for ChilloutVR.
 *
 * - No refetchInterval — auth is invalidation-driven (on login success), not polled.
 *   Polling auth would hammer the unofficial API and risk rate-limiting/account flags.
 * - staleTime: 0 so a fresh mount always checks current status.
 */
export function useAuthStatus(platform: Platform = 'vrchat'): UseQueryResult<AuthStatus, Error> {
  return useQuery({
    queryKey: authStatusQueryKey(platform),
    queryFn: () => fetchAuthStatus(platform),
    staleTime: 0
  })
}
