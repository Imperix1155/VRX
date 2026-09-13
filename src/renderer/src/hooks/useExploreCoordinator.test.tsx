// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, AuthStatus } from '@shared/types'
import type { ExplorePlatformSnapshot } from '@shared/explore'
import { authStatusQueryKey } from '../queries/auth'
import { exploreQueryKey, requestExplore } from '../queries/explore'
import { queryClient } from '../queries/queryClient'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import {
  clearExploreAutomaticGate,
  eligibleExploreAutomatic,
  useExploreCoordinator
} from './useExploreCoordinator'

const auth: AuthStatus = {
  platform: 'vrchat',
  state: 'authenticated',
  accountId: 'account-a',
  displayName: 'A'
}
const snapshot: ExplorePlatformSnapshot = {
  platform: 'vrchat',
  worlds: [],
  status: 'ready',
  problem: null,
  isStale: false,
  updatedAt: 10_000
}

function Coordinator(): React.JSX.Element {
  useExploreCoordinator()
  return <div />
}

beforeEach(() => {
  queryClient.clear()
  clearExploreAutomaticGate('vrchat')
  clearExploreAutomaticGate('chilloutvr')
  useUiStore.setState({ activeTab: 'explore' })
  useFriendsStore.setState({ platformFilter: 'vrchat' })
  queryClient.setQueryData(authStatusQueryKey('vrchat'), auth)
  queryClient.setQueryData(authStatusQueryKey('chilloutvr'), {
    platform: 'chilloutvr',
    state: 'unauthenticated',
    accountId: null,
    displayName: null
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  queryClient.clear()
})

describe('Explore automatic eligibility', () => {
  it('requires missing/stale cache and a five-minute account-scoped gap', () => {
    expect(eligibleExploreAutomatic('vrchat', auth, undefined, 100_000)).toBe(true)
    expect(eligibleExploreAutomatic('vrchat', auth, snapshot, 10_001)).toBe(false)
    expect(eligibleExploreAutomatic('vrchat', auth, { ...snapshot, isStale: true }, 100_000)).toBe(
      true
    )
  })

  it('coalesces a 1000-event focus/online storm to one eligible automatic request', async () => {
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    await act(async () => {
      for (let index = 0; index < 1_000; index += 1) {
        window.dispatchEvent(new Event(index % 2 === 0 ? 'focus' : 'online'))
      }
    })
    expect(getExplore).toHaveBeenCalledOnce()
  })

  it('permits a later visible focus only after the elapsed five-minute gate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    expect(getExplore).toHaveBeenCalledOnce()
    vi.setSystemTime(400_001)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getExplore).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not request a fresh cache or an off-view cache', async () => {
    const getExplore = vi.fn().mockResolvedValue(snapshot)
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, updatedAt: Date.now() })
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    expect(getExplore).not.toHaveBeenCalled()
    view.unmount()
    useUiStore.setState({ activeTab: 'friends' })
    queryClient.removeQueries({ queryKey: exploreQueryKey('vrchat') })
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    expect(getExplore).not.toHaveBeenCalled()
  })

  it('does not turn one-shot local freshness expiry into a new automatic request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const getExplore = vi
      .fn()
      .mockResolvedValueOnce({ ...snapshot, isStale: true, updatedAt: 0 })
      .mockResolvedValueOnce({ ...snapshot, isStale: false, updatedAt: 310_000 })
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    expect(getExplore).toHaveBeenCalledOnce()

    vi.setSystemTime(310_000)
    await act(async () => {
      await requestExplore('vrchat', 'manual')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getExplore).toHaveBeenCalledTimes(2)
  })

  it('uses a live socket reconnect as an eligible wake through the same gate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    let friendEvent: ((event: AdapterEvent) => void) | null = null
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: (listener: (event: AdapterEvent) => void) => {
        friendEvent = listener
        return () => {
          friendEvent = null
        }
      }
    } as unknown as Window['vrx']
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, updatedAt: 100_000 })
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    expect(getExplore).not.toHaveBeenCalled()

    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, isStale: true })
    await act(async () => friendEvent?.({ type: 'connection', platform: 'vrchat', health: 'live' }))
    expect(getExplore).toHaveBeenCalledOnce()
  })

  it('retains only a known authenticated identity through a transient auth error', async () => {
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: () => () => {},
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, updatedAt: Date.now() })
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    queryClient.setQueryData(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'error',
      accountId: null,
      displayName: null
    })
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, isStale: true })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getExplore).toHaveBeenCalledOnce()
  })

  it('drops that retained identity at its boundary so a null error account cannot start work', async () => {
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    let boundary: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | null = null
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: (listener: (event: { platform: 'vrchat' | 'chilloutvr' }) => void) => {
        boundary = listener
        return () => {
          boundary = null
        }
      },
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, updatedAt: Date.now() })
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    queryClient.setQueryData(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'error',
      accountId: null,
      displayName: null
    })
    await act(async () => boundary?.({ platform: 'vrchat' }))
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, isStale: true })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getExplore).not.toHaveBeenCalled()
  })

  it('quarantines the same cached authenticated status until a later auth result arrives', async () => {
    const getExplore = vi.fn().mockResolvedValue({ ...snapshot, isStale: true, updatedAt: 0 })
    let boundary: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | null = null
    window.vrx = {
      setExploreActive: vi.fn().mockResolvedValue(undefined),
      getExplore,
      onExploreChanged: () => () => {},
      onIdentityBoundary: (listener: (event: { platform: 'vrchat' | 'chilloutvr' }) => void) => {
        boundary = listener
        return () => {
          boundary = null
        }
      },
      onFriendEvent: () => () => {}
    } as unknown as Window['vrx']
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, updatedAt: Date.now() })
    render(
      <QueryClientProvider client={queryClient}>
        <Coordinator />
      </QueryClientProvider>
    )
    await act(async () => undefined)
    await act(async () => boundary?.({ platform: 'vrchat' }))
    queryClient.setQueryData(exploreQueryKey('vrchat'), { ...snapshot, isStale: true })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getExplore).not.toHaveBeenCalled()
  })
})
