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
import { QueryClient, QueryClientProvider, type QueryObserverOptions } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthState, AuthStatus, Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { fullFriend } from '../test-utils/friendFixture'
import { useFriends, friendsQueryKey } from './friends'

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
  queryClient: QueryClient
} {
  const getFriends = vi.fn().mockResolvedValue([])
  Object.assign(window, { vrx: { getFriends } })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useFriends('vrchat'), { wrapper })
  return { result, getFriends, queryClient }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
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
  it('applies fresh ±10% jitter on every reconcile interval tick', () => {
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
      dirty: false
    })
    const randomValues = [0, 0.5, 0.999]
    let randomIndex = 0
    vi.spyOn(Math, 'random').mockImplementation(
      () => randomValues[randomIndex++ % randomValues.length]!
    )
    const { queryClient } = renderFriends()
    const query = queryClient.getQueryCache().find({
      queryKey: ['friends', 'vrchat']
    })
    const interval = (query?.options as QueryObserverOptions | undefined)?.refetchInterval

    expect(typeof interval).toBe('function')
    if (typeof interval !== 'function' || query === undefined) {
      throw new Error('expected a query-backed interval function')
    }
    const values = [interval(query), interval(query), interval(query)]
    const numericValues = values.filter((value): value is number => typeof value === 'number')
    expect(numericValues).toHaveLength(3)
    expect(numericValues.every((value) => value >= 270_000 && value <= 330_000)).toBe(true)
    expect(new Set(numericValues).size).toBeGreaterThan(1)
  })

  it.each([
    ['5m', 300_000],
    ['10m', 600_000],
    ['30m', 1_800_000]
  ] as const)('refetches on the %s setting', async (reconcileInterval, intervalMs) => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
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
    // Deterministic settle under fake timers: flush microtasks until the query
    // SUCCEEDS — an unsettled query legitimately refetches on remount, which
    // made a fixed two-flush version CI-flaky.
    for (let i = 0; i < 20 && !first.result.current.isSuccess; i++) {
      await act(async () => {
        // Zero-advance runs due MACROtasks too — part of TanStack's settle path
        // rides setTimeout(0), which pure microtask flushes never reach under
        // fake timers (the CI flake's real mechanism).
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    expect(first.result.current.isSuccess).toBe(true)
    expect(getFriends).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })
    first.unmount()
    const second = renderHook(() => useFriends('vrchat'), { wrapper })
    for (let i = 0; i < 20 && second.result.current.fetchStatus !== 'idle'; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    expect(getFriends).toHaveBeenCalledTimes(1)
  })

  it('applies a changed cadence immediately to the mounted TanStack observer', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
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

describe('useFriends cold-start merge (VRX-258)', () => {
  it('keeps cached world names when the REST refetch returns the same worldId without names', async () => {
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: 'manual' },
      dirty: false
    })

    const instance = {
      worldId: 'wrld_same',
      instanceId: 'i1',
      worldName: 'Known World' as const,
      thumbnailUrl: 'https://example.com/know.jpg' as const,
      type: 'public' as const,
      openness: 'public' as const,
      isGroup: false,
      groupName: null,
      region: 'us',
      userCount: null
    }

    const seeded: Friend[] = [
      {
        ...fullFriend('Seeded', 'vrchat'),
        platformUserId: 'usr_same',
        status: 'online',
        presence: { state: 'in-game' },
        instance
      } as Friend
    ]

    const fetched: Friend[] = [
      {
        ...fullFriend('Refetched', 'vrchat'),
        platformUserId: 'usr_same',
        status: 'ask-me',
        presence: { state: 'in-game' },
        instance: { ...instance, instanceId: 'i2', worldName: null, thumbnailUrl: null }
      } as Friend
    ]

    const getFriends = vi.fn().mockResolvedValue(fetched)
    Object.assign(window, { vrx: { getFriends } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['friends', 'vrchat'], seeded)

    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useFriends('vrchat'), { wrapper })

    // With manual reconcile + seeded cache, the observer mounts on the known data
    // and does not fetch yet.
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data![0]!.displayName).toBe('Seeded')
    expect(getFriends).not.toHaveBeenCalled()

    // An explicit invalidation simulates the hydrate-driven background refetch.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['friends', 'vrchat'] })
    })
    await waitFor(() => expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' }))

    const data = result.current.data!
    expect(data[0]!.displayName).toBe('Refetched')
    expect(data[0]!.status).toBe('ask-me')
    expect(data[0]!.instance!.instanceId).toBe('i2')
    expect(data[0]!.instance!.worldName).toBe('Known World')
    expect(data[0]!.instance!.thumbnailUrl).toBe('https://example.com/know.jpg')
  })
})

/**
 * VRX-258 regression: a live `world-metadata` event that resolves a world name
 * while a REST refetch is in flight must survive the REST write.
 *
 * Gotchas carried over from the review probe:
 *  - The `// @vitest-environment jsdom` docblock at the top of this file is
 *    required; without it the mount hits "window is not defined".
 *  - Do NOT `await queryClient.invalidateQueries(...)` when the refetch is
 *    deliberately blocked on a pending promise — that promise only settles once
 *    the refetch settles, so awaiting it deadlocks and the test times out.
 */
describe('useFriends world-name survival during in-flight refetch (VRX-258)', () => {
  function friendWith(worldName: string | null): Friend {
    const inst = {
      worldId: 'wrld_D',
      instanceId: 'i1',
      worldName,
      thumbnailUrl: null as string | null,
      type: 'public' as const,
      openness: 'public' as const,
      isGroup: false,
      groupName: null,
      region: 'us',
      userCount: null
    }
    return {
      ...fullFriend('Racer', 'vrchat'),
      platformUserId: 'usr_race',
      status: 'online',
      presence: { state: 'in-game' },
      instance: inst
    } as Friend
  }

  it('keeps a world name written mid-fetch when the cache is read after the fetch resolves', async () => {
    mockAuthState('authenticated')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: 'manual' },
      dirty: false
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friendWith(null)])

    let release!: (v: Friend[]) => void
    const pending = new Promise<Friend[]>((r) => {
      release = r
    })
    const getFriends = vi.fn().mockReturnValue(pending)
    Object.assign(window, { vrx: { getFriends } })

    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    renderHook(() => useFriends('vrchat'), { wrapper })

    // Trigger the refetch, but do not await it — the promise is blocked.
    void queryClient.invalidateQueries({ queryKey: friendsQueryKey('vrchat') })
    await waitFor(() => expect(getFriends).toHaveBeenCalled())

    // WorldResolver warms up mid-fetch; a live world-metadata write lands.
    queryClient.setQueryData(friendsQueryKey('vrchat'), [friendWith("D's Name")])
    expect(
      queryClient.getQueryData<Friend[]>(friendsQueryKey('vrchat'))![0]!.instance!.worldName
    ).toBe("D's Name")

    // REST resolves with a still-null name (resolver was cold at fetch start).
    release([friendWith(null)])
    await waitFor(() => expect(getFriends).toHaveBeenCalledTimes(1))

    const after = queryClient.getQueryData<Friend[]>(friendsQueryKey('vrchat'))![0]!.instance!
      .worldName
    expect(after).toBe("D's Name")
  })
})
