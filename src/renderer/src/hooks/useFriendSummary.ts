import type { Friend } from '@shared/types'
import {
  isRosterPlaceholder,
  scopeByPlatformFilter,
  useCombineFriendQueries,
  useFriends,
  type FriendSourceFailure
} from '../queries/friends'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { useNotConnectedGate } from './useNotConnectedGate'

export interface FriendSummary {
  platformFilter: PlatformFilter
  /** Friends of the platforms the global filter shows. */
  friends: Friend[]
  /** A real roster arrived for a shown platform; the sign-in placeholder does not count. */
  hasData: boolean
  /** No roster yet, and a shown, signed-in platform is still loading rather than failed. */
  isLoading: boolean
  /** Asks every shown, signed-in platform again (the error line's Retry). */
  retry: () => void
  /** A shown platform that failed while another loaded (its own line). */
  sourceFailures: FriendSourceFailure[]
  isAuthStatusPending: boolean
  isNotConnected: boolean
  notConnectedKey: string | null
  openAccounts: () => void
}

/**
 * What the Dashboard and Hot Instances read from both friend lists under the
 * global platform filter. The empty roster a sign-in or account switch leaves
 * is not data: until the real one lands they say Loading (or the error), never
 * 0 / 0 / 0. A signed-out platform's disabled query stays pending forever and
 * refetch bypasses its gate, so only enabled queries drive loading and Retry.
 */
export function useFriendSummary(): FriendSummary {
  const vrcQuery = useFriends('vrchat')
  const cvrQuery = useFriends('chilloutvr')
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const scoped = scopeByPlatformFilter(platformFilter, vrcQuery, cvrQuery)
  const enabled = scoped.filter((q) => q.isEnabled !== false)
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const { sourceFailures } = useCombineFriendQueries(platformFilter, vrcQuery, cvrQuery)
  return {
    platformFilter,
    friends: scoped.flatMap((q) => q.data ?? []),
    hasData: scoped.some((q) => q.data != null && !isRosterPlaceholder(q)),
    isLoading: enabled.some((q) => q.isPending || (isRosterPlaceholder(q) && !q.isError)),
    retry: () => {
      for (const q of enabled) void q.refetch()
    },
    sourceFailures,
    isAuthStatusPending,
    isNotConnected,
    notConnectedKey:
      selectedPlatform === null ? null : NOT_CONNECTED_KEY.dashboard[selectedPlatform],
    openAccounts
  }
}
