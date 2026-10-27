/**
 * The Dashboard's "Wearing now" (owner, 2026-10-27): the avatar the user wears
 * on one platform. It reuses what the Avatars page already read and otherwise
 * asks main for the worn avatar alone (one platform request), never the whole
 * uploads list. Reads happen when the Dashboard opens with stale data; never on
 * a timer, window focus, or reconnect.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AvatarLibraryResult, CurrentAvatarResult } from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import {
  AVATAR_LIBRARY_STALE_MS,
  avatarLibraryQueryKey,
  useAvatarAccount,
  useAvatarLibrary
} from './avatarLibrary'

/** Account-keyed, so an old account's avatar can never show under a new one. */
export function currentAvatarQueryKey(
  platform: Platform,
  accountId: string | null
): readonly ['current-avatar', Platform, string | null] {
  return ['current-avatar', platform, accountId] as const
}

export interface WornAvatarState {
  /** Undefined until the first answer. A typed failure is data, not an error. */
  result: CurrentAvatarResult | undefined
  isPending: boolean
  /** The bridge call itself failed (for example the local rate limit). */
  isError: boolean
  refetch: () => void
}

/**
 * The worn avatar for one platform while `enabled` and signed in. The newer of
 * the two answers wins: the Avatars page's library (also updated by a Wear
 * press) or this Dashboard read.
 */
export function useWornAvatar(platform: Platform, enabled: boolean): WornAvatarState {
  const queryClient = useQueryClient()
  const accountId = useAvatarAccount(platform)
  // Observes the Avatars page's cache only; disabled, so it never reads.
  const library = useAvatarLibrary(platform, false)
  const current = useQuery({
    queryKey: currentAvatarQueryKey(platform, accountId),
    queryFn: async (): Promise<CurrentAvatarResult> => {
      // A fresh Avatars page read already says what is worn: no request.
      const state = queryClient.getQueryState<AvatarLibraryResult>(
        avatarLibraryQueryKey(platform, accountId)
      )
      if (state?.data?.ok && Date.now() - state.dataUpdatedAt < AVATAR_LIBRARY_STALE_MS) {
        return { ok: true, platform, current: state.data.current }
      }
      if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
      return window.vrx.getCurrentAvatar({ platform })
    },
    enabled: enabled && accountId !== null,
    staleTime: AVATAR_LIBRARY_STALE_MS,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'always'
  })

  const fromLibrary = library.data?.ok === true ? library.data : undefined
  const result: CurrentAvatarResult | undefined =
    fromLibrary && library.dataUpdatedAt >= current.dataUpdatedAt
      ? { ok: true, platform, current: fromLibrary.current }
      : current.data
  return {
    result,
    isPending: result === undefined && current.isPending,
    isError: result === undefined && current.isError,
    refetch: () => void current.refetch()
  }
}
