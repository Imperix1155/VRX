import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type {
  AvatarDetailsResult,
  AvatarItem,
  AvatarLibraryResult,
  AvatarSwitchResult
} from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import { keepShown, type Kept } from '../utils/community'
import { useAuthStatus } from './auth'

/** Account-keyed, so an old account's avatars can never show under a new one. */
export function avatarLibraryQueryKey(
  platform: Platform,
  accountId: string | null
): readonly ['avatar-library', Platform, string | null] {
  return ['avatar-library', platform, accountId] as const
}

function avatarDetailsQueryKey(
  platform: Platform,
  accountId: string | null,
  avatarId: string | null
): readonly ['avatar-details', Platform, string | null, string | null] {
  return ['avatar-details', platform, accountId, avatarId] as const
}

/** How long a loaded library counts as fresh. Refresh always reads again. */
export const AVATAR_LIBRARY_STALE_MS = 5 * 60_000

/**
 * A loaded library stays in memory for the whole session, so coming back to
 * the Avatars page shows it at once (and reads again only once it is stale)
 * instead of starting over after TanStack's default five unobserved minutes.
 * Keys carry the account, and an identity boundary removes the platform's
 * entries (`useLiveFriendEvents`), so nothing shows under another account.
 */
const AVATAR_LIBRARY_GC_MS = Infinity

/** Every avatar-library, avatar-details and Dashboard worn-avatar entry of one platform, any account. */
export function avatarQueryKeysForPlatform(
  platform: Platform
): readonly [
  readonly ['avatar-library', Platform],
  readonly ['avatar-details', Platform],
  readonly ['current-avatar', Platform]
] {
  return [
    ['avatar-library', platform] as const,
    ['avatar-details', platform] as const,
    // The Dashboard's `currentAvatarQueryKey` (queries/currentAvatar.ts).
    ['current-avatar', platform] as const
  ]
}

function bridge(): NonNullable<Window['vrx']> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  return window.vrx
}

/** The signed-in account a platform's avatar data belongs to, or null. */
export function useAvatarAccount(platform: Platform): string | null {
  const auth = useAuthStatus(platform)
  return auth.data?.state === 'authenticated' ? (auth.data.accountId ?? null) : null
}

/**
 * The user's own avatars and the worn one. Runs only while the Avatars page
 * shows this platform and it is signed in; never on a timer or window focus.
 * A typed failure is data (`ok: false`), not a thrown error, so it does not
 * retry on its own. A failed Refresh or re-read keeps the library that loaded,
 * marked `refreshFailed` (`keepShown`).
 */
export function useAvatarLibrary(
  platform: Platform,
  enabled: boolean
): UseQueryResult<Kept<AvatarLibraryResult>, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: avatarLibraryQueryKey(platform, accountId),
    queryFn: async ({ client, queryKey }) => {
      const askedAt = Date.now()
      const answer = await bridge().getAvatarLibrary({ platform })
      // A Wear that finished while this read was out is newer than the
      // platform's answer, which was read before the change.
      const wear = lastWear.get(queryKey.join('\u0000'))
      const settled =
        answer.ok && wear !== undefined && wear.at >= askedAt
          ? { ...answer, current: wear.avatar }
          : answer
      return keepShown(client.getQueryData<Kept<AvatarLibraryResult>>(queryKey), settled)
    },
    enabled: enabled && accountId !== null,
    staleTime: AVATAR_LIBRARY_STALE_MS,
    gcTime: AVATAR_LIBRARY_GC_MS,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'always'
  })
}

/** One avatar's details, read when its details panel opens. */
export function useAvatarDetails(
  platform: Platform,
  avatarId: string | null
): UseQueryResult<AvatarDetailsResult, Error> {
  const accountId = useAvatarAccount(platform)
  return useQuery({
    queryKey: avatarDetailsQueryKey(platform, accountId, avatarId),
    queryFn: () => bridge().getAvatarDetails({ platform, avatarId: avatarId! }),
    enabled: accountId !== null && avatarId !== null,
    staleTime: AVATAR_LIBRARY_STALE_MS,
    gcTime: AVATAR_LIBRARY_GC_MS,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'always'
  })
}

/** The last successful Wear per library key, for a read already out (above). */
const lastWear = new Map<string, { avatar: AvatarItem; at: number }>()

export interface SwitchAvatarInput {
  avatar: AvatarItem
  /** The account the page showed; only that account's cached library changes. */
  accountId: string
}

/**
 * Wear an avatar. On success the cached library shows it as worn right away,
 * even when a Refresh asked before the change answers after it; the next read
 * confirms what the platform reports. The platform just answered,
 * so a library kept after a failed read no longer counts as stale.
 */
export function useSwitchAvatar(): UseMutationResult<AvatarSwitchResult, Error, SwitchAvatarInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ avatar }) =>
      bridge().switchAvatar({ platform: avatar.platform, avatarId: avatar.avatarId }),
    networkMode: 'always',
    onSuccess: (result, { avatar, accountId }) => {
      if (!result.ok) return
      const key = avatarLibraryQueryKey(avatar.platform, accountId)
      lastWear.set(key.join('\u0000'), { avatar, at: Date.now() })
      queryClient.setQueryData<Kept<AvatarLibraryResult>>(key, (previous) =>
        previous?.ok
          ? {
              ...previous,
              current: avatar,
              refreshFailed: undefined,
              refreshRateLimited: undefined
            }
          : previous
      )
    }
  })
}
