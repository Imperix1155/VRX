// @vitest-environment jsdom
/**
 * useFriends auth-gate tests (VRX-191/201).
 *
 * Pins the `enabled` discriminator: `authenticated` and `error` fetch;
 * `unauthenticated` stays disabled. `error` must fetch (VRX-201) — on API
 * drift the session is typically still valid, and a disabled+unfetched query
 * is isPending forever (no auth polling), hanging social views on "Loading…".
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthState, AuthStatus } from '@shared/types'
import { useFriends } from './friends'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: (platform: string = 'vrchat') => ['auth-status', platform]
}))

function mockAuthState(state: AuthState): void {
  const status: AuthStatus = { platform: 'vrchat', state, accountId: null, displayName: null }
  useAuthStatusMock.mockReturnValue({ data: status, isPending: false })
}

function renderFriends(): {
  result: { current: ReturnType<typeof useFriends> }
  getFriends: ReturnType<typeof vi.fn>
} {
  const getFriends = vi.fn().mockResolvedValue([])
  Object.assign(window, { vrx: { getFriends } })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useFriends('vrchat'), { wrapper })
  return { result, getFriends }
}

afterEach(() => {
  useAuthStatusMock.mockReset()
  Object.assign(window, { vrx: undefined })
})

describe('useFriends enabled gate', () => {
  it.each(['authenticated', 'error'] as const)('fetches under auth state %s', async (state) => {
    mockAuthState(state)
    const { result, getFriends } = renderFriends()

    await waitFor(() => expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
  })

  it('stays disabled (no fetch) under unauthenticated', async () => {
    mockAuthState('unauthenticated')
    const { result, getFriends } = renderFriends()

    // Disabled query: never fetches, stays idle — assert it settled that way.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(getFriends).not.toHaveBeenCalled()
    expect(result.current.isPending).toBe(true)
  })
})
