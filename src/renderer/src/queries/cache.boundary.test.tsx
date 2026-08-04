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
import { cleanup, render, act } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useLiveFriendEvents } from '../hooks/useLiveFriendEvents'
import { useFriends } from './friends'
import {
  buildCacheBuster,
  buildPersistOptions,
  onPersistRestore,
  QUERY_CACHE_STORAGE_KEY
} from './cache'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: (platform: string = 'vrchat') => ['auth-status', platform]
}))

function mockAuthState(): void {
  useAuthStatusMock.mockReturnValue({
    data: { platform: 'vrchat', state: 'authenticated', accountId: null, displayName: null },
    isPending: false
  })
}

function seededFriend(platform: 'vrchat' | 'chilloutvr', name: string): Friend {
  return {
    platformUserId: `usr_${name.toLowerCase()}`,
    platform,
    displayName: name,
    avatarUrl: null,
    presence: { state: 'online' },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as unknown as Friend
}

function buildPersistedPayload(
  entries: Array<{ platform: 'vrchat' | 'chilloutvr'; friends: Friend[] }>
): {
  buster: string
  timestamp: number
  clientState: { mutations: []; queries: unknown[] }
} {
  const now = Date.now()
  return {
    buster: buildCacheBuster(),
    timestamp: now,
    clientState: {
      mutations: [],
      queries: entries.map(({ platform, friends }) => ({
        queryHash: JSON.stringify(['friends', platform]),
        queryKey: ['friends', platform],
        state: {
          data: friends,
          dataUpdateCount: 1,
          dataUpdatedAt: now,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: 'success',
          fetchStatus: 'idle'
        },
        promise: null
      }))
    }
  }
}

function FriendsProbe({
  onData
}: {
  onData: (friends: Friend[] | undefined) => void
}): React.JSX.Element {
  useLiveFriendEvents()
  const { data } = useFriends('vrchat')
  useEffect(() => {
    onData(data)
  }, [data, onData])
  return <></>
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
  onData: (friends: Friend[] | undefined) => void
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

beforeEach(() => {
  vi.useFakeTimers()
  mockAuthState()
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
    dirty: false
  })
  window.localStorage.clear()
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

describe('persisted cache boundary wipe', () => {
  it('identity-boundary leaves no account-A data in localStorage after the throttle window', async () => {
    const accountAVrc = [seededFriend('vrchat', 'AccountA')]
    const accountACvr = [seededFriend('chilloutvr', 'AccountA')]
    const accountB = [seededFriend('vrchat', 'AccountB')]
    const getFriends = vi.fn().mockResolvedValueOnce(accountAVrc).mockResolvedValueOnce(accountB)
    stubBridge({ getFriends })

    // Seed AccountA for BOTH platforms. A boundary on VRChat must not leave
    // ChilloutVR's AccountA roster on disk either.
    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify(
        buildPersistedPayload([
          { platform: 'vrchat', friends: accountAVrc },
          { platform: 'chilloutvr', friends: accountACvr }
        ])
      )
    )
    const epochBefore = buildCacheBuster()

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observed: (Friend[] | undefined)[] = []
    mountBoundary(queryClient, (friends) => observed.push(friends))

    // Let the provider restore and the initial fetch settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(observed.some((list) => list?.[0]?.displayName === 'AccountA')).toBe(true)

    // Account switch on VRChat: fire identity-boundary, then advance well past the 1s
    // persister throttle + the 1.5s delayed wipe.
    await act(async () => {
      fireIdentityBoundary!({ platform: 'vrchat' })
      await vi.advanceTimersByTimeAsync(3000)
    })

    // The previous account's data must not have leaked back to disk.
    expect(storedContainsDisplayName('AccountA')).toBe(false)
    // Epoch was bumped, so a leaked write with the old buster is discarded on
    // the next cold start.
    expect(buildCacheBuster()).not.toBe(epochBefore)
  })

  it('auth-invalidated leaves no account-A data in localStorage after the throttle window', async () => {
    const accountAVrc = [seededFriend('vrchat', 'AccountA')]
    const accountACvr = [seededFriend('chilloutvr', 'AccountA')]
    const getFriends = vi.fn().mockResolvedValueOnce(accountAVrc).mockResolvedValueOnce([])
    stubBridge({ getFriends })

    // Seed AccountA for BOTH platforms. Auth-invalidated on VRChat must not
    // leave ChilloutVR's AccountA roster on disk either.
    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify(
        buildPersistedPayload([
          { platform: 'vrchat', friends: accountAVrc },
          { platform: 'chilloutvr', friends: accountACvr }
        ])
      )
    )
    const epochBefore = buildCacheBuster()

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observed: (Friend[] | undefined)[] = []
    mountBoundary(queryClient, (friends) => observed.push(friends))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(observed.some((list) => list?.[0]?.displayName === 'AccountA')).toBe(true)

    await act(async () => {
      fireFriendEvent!({ type: 'auth-invalidated', platform: 'vrchat' })
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(storedContainsDisplayName('AccountA')).toBe(false)
    expect(buildCacheBuster()).not.toBe(epochBefore)
  })
})
