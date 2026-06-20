import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AuthStatus } from '@shared/types'

/** Query key for VRChat auth status. */
export const authStatusQueryKey = ['auth-status', 'vrchat'] as const

/**
 * Fetch auth status over the IPC bridge. Guards `window.vrx` being absent
 * (Preview/test env), mirroring the friends query pattern.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx.getAuthStatus({ platform: 'vrchat' })
}

/**
 * Auth status query (VRX-158). Drives the auth gate in App.tsx.
 *
 * - No refetchInterval — auth is invalidation-driven (on login success), not polled.
 *   Polling auth would hammer the unofficial API and risk rate-limiting/account flags.
 * - staleTime: 0 so a fresh mount always checks current status.
 */
export function useAuthStatus(): UseQueryResult<AuthStatus, Error> {
  return useQuery({
    queryKey: authStatusQueryKey,
    queryFn: fetchAuthStatus,
    staleTime: 0
  })
}
