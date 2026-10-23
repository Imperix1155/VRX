import type { AuthStatus, Platform } from '@shared/types'
import type { PlatformFilter } from '../stores/friends'
import { useAuthStatus } from '../queries/auth'
import { useUiStore } from '../stores/ui'

export interface NotConnectedGate {
  /** The single platform in filter scope, or null for `all`. */
  selectedPlatform: Platform | null
  /** Filtered platform's auth query hasn't produced ANY status yet → show loading. */
  isAuthStatusPending: boolean
  /** Settled, successful, non-refetching `unauthenticated` or `needs-2fa` → show the Connect CTA. */
  isNotConnected: boolean
  /** Navigate to Settings → Accounts (the CTA's action). */
  openAccounts: () => void
}

/**
 * The discriminator itself, for a surface that reads auth from the cache
 * instead of mounting a query observer (Explore).
 */
export function isNotConnectedAuth(auth: {
  data: AuthStatus | undefined
  isSuccess: boolean
  isFetching: boolean
}): boolean {
  return (
    auth.isSuccess &&
    // A saved VRChat session waiting for a fresh 2FA code is not connected
    // either; Accounts is where the code is entered.
    (auth.data?.state === 'unauthenticated' || auth.data?.state === 'needs-2fa') &&
    !auth.isFetching
  )
}

/**
 * The one definition of the VRX-192 not-connected discriminator, shared by every
 * social surface (FriendsList, DashboardView) so they gate identically.
 *
 * The Connect CTA is trustworthy only after the filtered platform's auth query
 * has settled SUCCESSFULLY: initial auth loading takes precedence over a friends
 * failure; stale `unauthenticated` data must not flash the CTA during its
 * post-login refetch; and a FAILED settled refetch (stale data + isError) must
 * keep the non-CTA rendering rather than mask the auth-status failure.
 */
export function useNotConnectedGate(platformFilter: PlatformFilter): NotConnectedGate {
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  const selectedPlatform: Platform | null = platformFilter === 'all' ? null : platformFilter
  const authStatus = useAuthStatus(selectedPlatform ?? 'vrchat')
  return {
    selectedPlatform,
    isAuthStatusPending:
      selectedPlatform !== null && authStatus.data === undefined && authStatus.isPending,
    isNotConnected: selectedPlatform !== null && isNotConnectedAuth(authStatus),
    openAccounts: (): void => {
      setActiveTab('settings')
      setSettingsCategory('accounts')
    }
  }
}
