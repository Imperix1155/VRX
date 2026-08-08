// @vitest-environment jsdom
/**
 * TanStack Query cache persistence boundary tests (VRX-155).
 *
 * Reproduces the review finding: the sync storage persister throttles writes on
 * a 1s timer, so a boundary handler's own cache mutations can re-persist the
 * previous account's data AFTER the synchronous localStorage removeItem. These
 * tests fire a boundary event under fake timers, advance well past the throttle
 * window, and assert localStorage holds no account-owned data once quiescent.
 */
import { useEffect } from 'react'
import { cleanup, render, act, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useLiveFriendEvents } from '../hooks/useLiveFriendEvents'
import { useFriendsStore } from '../stores/friends'
import FriendsList from '../components/FriendsList'
import '../i18n'
import { friendsQueryKey, useFriends } from './friends'
import { buildPersistOptions, onPersistRestore, QUERY_CACHE_STORAGE_KEY } from './cache'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: (platform: string = 'vrchat') => ['auth-status', platform]
}))

function mockAuthState(cvrState: 'authenticated' | 'unauthenticated' = 'authenticated'): void {
  useAuthStatusMock.mockImplementation((platform: 'vrchat' | 'chilloutvr') => {
    const state = platform === 'vrchat' ? 'authenticated' : cvrState
    return {
      data: {
        platform,
        state,
        accountId: state === 'authenticated' ? `${platform}-account` : null,
        displayName: state === 'authenticated' ? `${platform} account` : null
      },
      isPending: false,
      isSuccess: true,
      isFetching: false
    }
  })
}

function seededFriend(platform: 'vrchat' | 'chilloutvr', name: string): Friend {
  return {
    platformUserId: `usr_${name.toLowerCase()}`,
    platform,
    displayName: name,
    avatarUrl: null,
    presence: { state: platform === 'vrchat' ? 'active' : 'offline' },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as unknown as Friend
}

function FriendsProbe({
  onData
}: {
  onData: (snapshot: {
    vrc: Friend[] | undefined
    cvr: Friend[] | undefined
    vrcPending: boolean
  }) => void
}): React.JSX.Element {
  useLiveFriendEvents()
  const vrc = useFriends('vrchat')
  const cvr = useFriends('chilloutvr')
  useEffect(() => {
    onData({ vrc: vrc.data, cvr: cvr.data, vrcPending: vrc.isPending })
  }, [vrc.data, cvr.data, vrc.isPending, onData])
  return <></>
}

function FriendsListProbe(): React.JSX.Element {
  useLiveFriendEvents()
  return <FriendsList />
}

let fireFriendEvent: ((e: unknown) => void) | undefined
let fireIdentityBoundary: ((payload: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined

function stubBridge(overrides: Record<string, unknown> = {}): void {
  const onFriendEvent = (cb: (e: unknown) => void): (() => void) => {
    fireFriendEvent = cb
    return () => {
      fireFriendEvent = undefined
    }
  }
  const onIdentityBoundary = (
    cb: (payload: { platform: 'vrchat' | 'chilloutvr' }) => void
  ): (() => void) => {
    fireIdentityBoundary = cb
    return () => {
      fireIdentityBoundary = undefined
    }
  }
  Object.assign(window, { vrx: { onFriendEvent, onIdentityBoundary, ...overrides } })
}

function mountBoundary(
  queryClient: QueryClient,
  onData: (snapshot: {
    vrc: Friend[] | undefined
    cvr: Friend[] | undefined
    vrcPending: boolean
  }) => void
): ReturnType<typeof render> {
  return render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={buildPersistOptions()}
      onSuccess={() => onPersistRestore(queryClient)}
    >
      <FriendsProbe onData={onData} />
    </PersistQueryClientProvider>
  )
}

function mountFriendsList(queryClient: QueryClient): ReturnType<typeof render> {
  return render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={buildPersistOptions()}
      onSuccess={() => onPersistRestore(queryClient)}
    >
      <FriendsListProbe />
    </PersistQueryClientProvider>
  )
}

function parseStoredCache(): unknown {
  const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function storedContainsDisplayName(name: string): boolean {
  const stored = parseStoredCache() as {
    clientState?: { queries?: Array<{ state?: { data?: Friend[] } }> }
  } | null
  if (stored === null) return false
  const queries = stored.clientState?.queries ?? []
  return queries.some((query) => query.state?.data?.some((friend) => friend.displayName === name))
}

function storedFriends(platform: 'vrchat' | 'chilloutvr'): Friend[] | undefined {
  const stored = parseStoredCache() as {
    clientState?: {
      queries?: Array<{
        queryKey?: unknown[]
        state?: { data?: Friend[] }
      }>
    }
  } | null
  return stored?.clientState?.queries?.find(
    (query) => query.queryKey?.[0] === 'friends' && query.queryKey[1] === platform
  )?.state?.data
}

beforeEach(() => {
  vi.useFakeTimers()
  mockAuthState()
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
    dirty: false
  })
  window.localStorage.clear()
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useAuthStatusMock.mockReset()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  window.localStorage.clear()
  Object.assign(window, { vrx: undefined })
  fireFriendEvent = undefined
  fireIdentityBoundary = undefined
})

describe('persisted cache boundaries', () => {
  it.each(['identity-boundary', 'auth-invalidated'] as const)(
    '%s keeps mounted observers settled and preserves the other platform in memory and storage',
    async (boundary) => {
      const accountAVrc = [seededFriend('vrchat', 'VrcAccountA')]
      const accountBCvr = [seededFriend('chilloutvr', 'CvrAccountB')]
      const getFriends = vi.fn(() => new Promise<Friend[]>(() => {}))
      stubBridge({ getFriends })

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      queryClient.setQueryData(friendsQueryKey('vrchat'), accountAVrc)
      queryClient.setQueryData(friendsQueryKey('chilloutvr'), accountBCvr)
      const observed: Array<{
        vrc: Friend[] | undefined
        cvr: Friend[] | undefined
        vrcPending: boolean
      }> = []
      mountBoundary(queryClient, (snapshot) => observed.push(snapshot))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(observed.at(-1)?.vrc).toEqual(accountAVrc)
      expect(observed.at(-1)?.cvr).toEqual(accountBCvr)

      await act(async () => {
        if (boundary === 'identity-boundary') fireIdentityBoundary!({ platform: 'vrchat' })
        else fireFriendEvent!({ type: 'auth-invalidated', platform: 'vrchat' })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(observed.at(-1)).toMatchObject({ vrc: [], cvr: accountBCvr, vrcPending: false })
      expect(queryClient.getQueryData(friendsQueryKey('vrchat'))).toEqual([])
      expect(queryClient.getQueryData(friendsQueryKey('chilloutvr'))).toEqual(accountBCvr)
      // The boundary write is synchronous: disk matches memory before the
      // provider's 1s throttled writer has had a chance to flush.
      expect(storedContainsDisplayName('VrcAccountA')).toBe(false)
      expect(storedFriends('vrchat')).toEqual([])
      expect(storedFriends('chilloutvr')).toEqual(accountBCvr)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200)
      })
      expect(storedFriends('vrchat')).toEqual([])
      expect(storedFriends('chilloutvr')).toEqual(accountBCvr)
    }
  )

  it('does not strand the default all-platform FriendsList in loading after a boundary', async () => {
    mockAuthState('unauthenticated')
    const accountAVrc = [seededFriend('vrchat', 'VrcAccountA')]
    stubBridge({ getFriends: vi.fn(() => new Promise<Friend[]>(() => {})) })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(friendsQueryKey('vrchat'), accountAVrc)
    mountFriendsList(queryClient)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('VrcAccountA')).toBeTruthy()

    await act(async () => {
      fireIdentityBoundary!({ platform: 'vrchat' })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.getByText('No friends online')).toBeTruthy()
  })
})
