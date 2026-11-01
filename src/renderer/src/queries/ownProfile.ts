/**
 * The signed-in user's own profile for the Settings → Accounts editor. Read
 * when the editor opens (main reuses an answer for 30 s) and dropped when it
 * closes; never on a timer, window focus or reconnect. Keyed by account, so
 * an old account's profile can never show under a new one.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { OwnProfileChanges, OwnProfileResult, SaveOwnProfileResult } from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import { useAvatarAccount } from './avatarLibrary'

export function ownProfileQueryKey(
  platform: Platform,
  accountId: string | null
): readonly ['own-profile', Platform, string | null] {
  return ['own-profile', platform, accountId] as const
}

function bridge(): NonNullable<Window['vrx']> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx
}

export function useOwnProfile(platform: Platform): UseQueryResult<OwnProfileResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: ownProfileQueryKey(platform, accountId),
    queryFn: () => bridge().getOwnProfile({ platform }),
    enabled: accountId !== null,
    // Each opening asks main again; main decides whether that reaches the platform.
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    // A typed failure is data (`ok: false`), not a thrown error; never retry alone.
    retry: false,
    networkMode: 'always'
  })
}

export async function saveOwnProfile(
  platform: Platform,
  changes: OwnProfileChanges
): Promise<SaveOwnProfileResult> {
  try {
    return await bridge().saveOwnProfile({ platform, changes })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
