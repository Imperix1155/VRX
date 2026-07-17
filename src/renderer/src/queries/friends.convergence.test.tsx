// @vitest-environment jsdom
/**
 * Dynamic dead-session convergence test (VRX-201 fix round 3).
 *
 * `friends.enabled.test.tsx` pins the STATIC enabled states by mocking the
 * `useAuthStatus` hook. This file drives the dynamic no-doom-loop guarantee
 * with the REAL auth query and everything mocked at the bridge (IPC) layer:
 *
 *   auth `error` → friends fetch fires and 401s → the adapter clears the
 *   session and emits auth-invalidated → the live pipeline invalidates the
 *   auth-status query (useLiveFriendEvents does exactly
 *   `invalidateQueries(authStatusQueryKey)`) → the refetch returns
 *   `unauthenticated` → the friends query re-disables.
 *
 * The load-bearing assertion is the CALL COUNT: exactly ONE friends request
 * total — a retry-loop regression (query staying enabled and re-fetching a
 * dead session) would fail here and nowhere else in the committed suite.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus, Platform } from '@shared/types'
import { authStatusQueryKey } from './auth'
import { friendsQueryKey, useFriends } from './friends'

afterEach(() => {
  Object.assign(window, { vrx: undefined })
})

describe('useFriends dead-session convergence (no doom loop)', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'on %s: error → one 401 fetch → auth converges unauthenticated → query disables',
    async (platform: Platform) => {
      // Mutable bridge-level auth state — the REAL useAuthStatus fetches this.
      let authState: AuthStatus = { platform, state: 'error', accountId: null, displayName: null }
      const getAuthStatus = vi.fn(() => Promise.resolve(authState))
      // The friends fetch hits the dead session and 401s (always — if the query
      // ever re-enables and retries, the count assertion below catches it).
      const getFriends = vi.fn(() => Promise.reject(new Error('auth_expired_401')))
      Object.assign(window, { vrx: { getAuthStatus, getFriends } })

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => useFriends(platform), { wrapper })

      // Auth settles `error` → the gate enables → the doomed fetch fires once.
      await waitFor(() => expect(getFriends).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.isError).toBe(true))

      // The adapter has now cleared the dead session (existing main-process
      // behavior on a data-path 401); the next status read is `unauthenticated`.
      authState = { platform, state: 'unauthenticated', accountId: null, displayName: null }
      // The live pipeline's auth-invalidated handler does exactly this
      // (useLiveFriendEvents): re-check auth so the UI converges.
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) })

      // Convergence: auth lands `unauthenticated` and the friends query is
      // DISABLED and idle — settled, not looping.
      await waitFor(() =>
        expect(queryClient.getQueryData<AuthStatus>(authStatusQueryKey(platform))?.state).toBe(
          'unauthenticated'
        )
      )
      await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))

      // Wake probe: an errored-but-still-enabled query would look identical
      // (idle) until something wakes it — and the real app wakes queries
      // constantly (roster-changed invalidations, the reconcile interval,
      // remounts). Poke the exact wake path: invalidation refetches an ENABLED
      // query and no-ops on a disabled one.
      await queryClient.invalidateQueries({ queryKey: friendsQueryKey(platform) })
      await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))

      // THE guard: exactly ONE friends request ever went out. A regression that
      // keeps the query enabled against a dead session re-fetches on the wake
      // probe and fails this count.
      expect(getFriends).toHaveBeenCalledTimes(1)
    }
  )
})
