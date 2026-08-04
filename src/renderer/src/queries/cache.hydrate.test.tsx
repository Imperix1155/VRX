// @vitest-environment jsdom
/**
 * TanStack Query cache persistence hydration tests (VRX-155).
 *
 * Pins: a schema/app buster change discards the persisted payload, and a seeded
 * cache renders the last-known friends list immediately before the background
 * refetch replaces it.
 */
import { useEffect } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { friendsQueryKey, useFriends } from './friends'
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

function seededFriend(name: string): Friend {
  return {
    platformUserId: `usr_${name.toLowerCase()}`,
    platform: 'vrchat',
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

function FriendsProbe({
  onData
}: {
  onData: (friends: Friend[] | undefined) => void
}): React.JSX.Element {
  const { data } = useFriends('vrchat')
  useEffect(() => {
    onData(data)
  }, [data, onData])
  return <></>
}

async function seedPersistedCache(payload: {
  buster: string
  timestamp: number
  clientState: { mutations: []; queries: unknown[] }
}): Promise<void> {
  window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, JSON.stringify(payload))
}

function buildPersistedPayload(
  friends: Friend[],
  overrides: { buster?: string; timestamp?: number; dataUpdatedAt?: number } = {}
): {
  buster: string
  timestamp: number
  clientState: { mutations: []; queries: unknown[] }
} {
  const buster = overrides.buster ?? buildCacheBuster()
  const timestamp = overrides.timestamp ?? Date.now()
  const dataUpdatedAt = overrides.dataUpdatedAt ?? timestamp
  return {
    buster,
    timestamp,
    clientState: {
      mutations: [],
      queries: [
        {
          queryHash: '["friends","vrchat"]',
          queryKey: ['friends', 'vrchat'],
          state: {
            data: friends,
            dataUpdateCount: 1,
            dataUpdatedAt,
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
        }
      ]
    }
  }
}

function mountHydrate(
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStatusMock.mockReset()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  window.localStorage.clear()
  Object.assign(window, { vrx: undefined })
})

beforeEach(() => {
  mockAuthState()
})

describe('PersistQueryClientProvider hydrate', () => {
  it('discards a persisted payload whose buster does not match the current app/schema', async () => {
    const seeded = [seededFriend('AccountA')]
    await seedPersistedCache(
      buildPersistedPayload(seeded, { buster: '0.0.0.0', dataUpdatedAt: Date.now() - 1000 })
    )

    // Hang the fetch so we can inspect the post-restore, pre-fetch state.
    const getFriends = vi.fn().mockImplementation(() => new Promise<Friend[]>(() => {}))
    Object.assign(window, { vrx: { getFriends } })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mountHydrate(queryClient, vi.fn())

    await waitFor(() =>
      expect(queryClient.getQueryState(friendsQueryKey('vrchat'))?.fetchStatus).toBe('fetching')
    )

    // Buster mismatch: the stored data is thrown away, so the query has no seed.
    expect(queryClient.getQueryData(friendsQueryKey('vrchat'))).toBeUndefined()
  })

  it('revalidates immediately even when the hydrated data is still inside staleTime', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
      dirty: false
    })

    const seeded = [seededFriend('Seeded')]
    const fetched = [seededFriend('Refetched')]
    const getFriends = vi
      .fn()
      .mockImplementation(() => Promise.resolve().then<Friend[]>(() => fetched))
    Object.assign(window, { vrx: { getFriends } })

    // Seed data is FRESH: only 60 seconds old against a 5-minute staleTime.
    // Without the onSuccess invalidation, useFriends would see this as not stale
    // and would never dispatch a fetch.
    const payload = buildPersistedPayload(seeded, {
      dataUpdatedAt: Date.now() - 60_000
    })
    await seedPersistedCache(payload)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mountHydrate(queryClient, vi.fn())

    await waitFor(() =>
      expect(queryClient.getQueryData<Friend[]>(friendsQueryKey('vrchat'))?.[0]?.displayName).toBe(
        'Refetched'
      )
    )

    expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' })
  })

  it('paints the seeded friends list immediately, then refetches and replaces it', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
      dirty: false
    })

    const seeded = [seededFriend('Seeded')]
    const fetched = [seededFriend('Refetched')]
    // Resolve after a microtask so React has time to render the hydrated seed
    // before the refetch replaces it.
    const getFriends = vi
      .fn()
      .mockImplementation(() => Promise.resolve().then<Friend[]>(() => fetched))
    Object.assign(window, { vrx: { getFriends } })

    // Seed data is older than the 5-minute staleTime so it is stale on hydrate.
    const payload = buildPersistedPayload(seeded, {
      dataUpdatedAt: Date.now() - 6 * 60 * 1000
    })
    await seedPersistedCache(payload)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observed: (Friend[] | undefined)[] = []
    const onData = (friends: Friend[] | undefined): void => {
      observed.push(friends)
    }
    mountHydrate(queryClient, onData)

    // Hydrated data appears first.
    await waitFor(() =>
      expect(observed.some((list) => list?.[0]?.displayName === 'Seeded')).toBe(true)
    )

    // Refetch eventually replaces the list.
    await waitFor(() =>
      expect(queryClient.getQueryData<Friend[]>(friendsQueryKey('vrchat'))?.[0]?.displayName).toBe(
        'Refetched'
      )
    )

    expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' })
  })
})
