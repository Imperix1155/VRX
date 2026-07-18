// @vitest-environment jsdom
/**
 * useFriends auth-gate tests (VRX-191/201).
 *
 * Pins the `enabled` discriminator: `authenticated` and `error` fetch;
 * `unauthenticated` stays disabled. `error` must fetch (VRX-201) — on API
 * drift the session is typically still valid, and a disabled+unfetched query
 * is isPending forever (no auth polling), hanging social views on "Loading…".
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthState, AuthStatus } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
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
  cleanup()
  vi.useRealTimers()
  useAuthStatusMock.mockReset()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
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

describe('useFriends background reconcile cadence (VRX-77)', () => {
  it.each([
    ['5m', 300_000],
    ['10m', 600_000],
    ['30m', 1_800_000]
  ] as const)('refetches on the %s setting', async (reconcileInterval, intervalMs) => {
    vi.useFakeTimers()
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval },
      dirty: false
    })
    const { getFriends } = renderFriends()

    await act(async () => {
      await Promise.resolve()
    })
    expect(getFriends).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs - 1)
    })
    expect(getFriends).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getFriends).toHaveBeenCalledTimes(2)
  })

  it('manual disables background refetches', async () => {
    vi.useFakeTimers()
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: 'manual' },
      dirty: false
    })
    const { getFriends } = renderFriends()

    await act(async () => {
      await Promise.resolve()
    })
    expect(getFriends).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_800_000 * 2)
    })
    expect(getFriends).toHaveBeenCalledTimes(1)
  })

  it('manual survives a remount long after staleness would have expired (Infinity staleTime — Kimi review)', async () => {
    // The finite-staleTime fallback let refetchOnMount fire after 5 minutes
    // despite "manual". Remounting the observer on the SAME client an hour
    // later must NOT trigger a fetch: exactly ONE call, from the first mount.
    vi.useFakeTimers()
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: 'manual' },
      dirty: false
    })
    const getFriends = vi.fn().mockResolvedValue([])
    Object.assign(window, { vrx: { getFriends } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const first = renderHook(() => useFriends('vrchat'), { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    expect(getFriends).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })
    first.unmount()
    renderHook(() => useFriends('vrchat'), { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    expect(getFriends).toHaveBeenCalledTimes(1)
  })

  it('applies a changed cadence immediately to the mounted TanStack observer', async () => {
    vi.useFakeTimers()
    mockAuthState('authenticated')
    const { getFriends } = renderFriends()

    await act(async () => {
      await Promise.resolve()
    })
    expect(getFriends).toHaveBeenCalledTimes(1)

    act(() =>
      useSettingsStore.getState().updateSettings({
        reconcileInterval: '10m'
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(getFriends).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(getFriends).toHaveBeenCalledTimes(2)
  })
})
