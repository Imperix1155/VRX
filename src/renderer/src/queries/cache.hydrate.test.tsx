// @vitest-environment jsdom
/**
 * TanStack Query cache persistence hydration tests (VRX-155).
 *
 * Pins: a schema/app buster change discards the persisted payload, and a seeded
 * cache renders the last-known friends list immediately before the background
 * refetch replaces it.
 */
import { useEffect } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useProfileSelection } from '../stores/profileSelection'
import { useFriendsStore } from '../stores/friends'
import ErrorBoundary from '../components/ErrorBoundary'
import FriendsList from '../components/FriendsList'
import '../i18n'
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
    presence: { state: 'active' },
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
  overrides: { buster?: string; timestamp?: number; dataUpdatedAt?: number; platform?: string } = {}
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
          dehydratedAt: timestamp,
          queryHash: `["friends","${overrides.platform ?? 'vrchat'}"]`,
          queryKey: ['friends', overrides.platform ?? 'vrchat'],
          state: {
            data: friends,
            dataUpdateCount: 1,
            dataUpdatedAt,
            error: null,
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

function mountFriendsListHydrate(queryClient: QueryClient): ReturnType<typeof render> {
  return render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={buildPersistOptions()}
      onSuccess={() => onPersistRestore(queryClient)}
    >
      <ErrorBoundary variant="panel">
        <FriendsList />
      </ErrorBoundary>
    </PersistQueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStatusMock.mockReset()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
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

  it('hydration round-trips CVR group fields (VRX-263 — the card must survive a restart)', async () => {
    // The hydration schema is platform-agnostic today; this pins that a future
    // platform-specific transform can never silently null CVR group metadata
    // (card would vanish after restart until REST re-enrichment).
    const cvrGroupFriend = {
      platformUserId: 'usr_cvrgrp',
      platform: 'chilloutvr',
      displayName: 'CvrGrouper',
      avatarUrl: null,
      presence: { state: 'in-game' },
      status: null,
      statusDescription: null,
      trustRank: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null,
      instance: {
        worldId: 'world-guid-1',
        instanceId: 'i+grp1',
        worldName: 'Movie World',
        thumbnailUrl: null,
        type: 'friends-of-members',
        openness: 'friends-plus',
        isGroup: true,
        groupName: 'Bonos Movie Night',
        groupId: '8c7cad5b-0000-0000-0000-000000000000',
        groupImageUrl: 'https://files.chilloutvr.net/groups/x/images/y.png',
        region: 'eu',
        userCount: 5
      }
    } as unknown as Friend

    // Hang the refetch so we inspect the pure hydrated state.
    const getFriends = vi.fn().mockImplementation(() => new Promise<Friend[]>(() => {}))
    Object.assign(window, { vrx: { getFriends } })
    await seedPersistedCache(
      buildPersistedPayload([cvrGroupFriend], {
        dataUpdatedAt: Date.now() - 1000,
        platform: 'chilloutvr'
      })
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mountHydrate(queryClient, vi.fn())

    await waitFor(() => {
      const hydrated = queryClient.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))
      expect(hydrated?.[0]?.instance?.groupName).toBe('Bonos Movie Night')
    })
    const hydrated = queryClient.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))
    expect(hydrated?.[0]?.instance?.groupId).toBe('8c7cad5b-0000-0000-0000-000000000000')
    expect(hydrated?.[0]?.instance?.groupImageUrl).toBe(
      'https://files.chilloutvr.net/groups/x/images/y.png'
    )
  })

  it('paints the seeded list immediately, then refetches and replaces presence/status but preserves known world names for the same world', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, reconcileInterval: '5m' },
      dirty: false
    })

    const instanceBase = {
      worldId: 'wrld_same',
      instanceId: 'i1',
      worldName: 'Known World' as const,
      thumbnailUrl: 'https://example.com/know.jpg' as const,
      type: 'public' as const,
      openness: 'public' as const,
      isGroup: false,
      groupName: null,
      groupId: null,
      groupImageUrl: null,
      region: 'us',
      userCount: null
    }

    const seeded = [
      {
        ...seededFriend('Seeded'),
        platformUserId: 'usr_same',
        status: 'online' as const,
        instance: instanceBase
      } as Friend
    ]

    const fetched = [
      {
        ...seededFriend('Refetched'),
        platformUserId: 'usr_same',
        status: 'ask-me' as const,
        presence: { state: 'in-game' as const },
        instance: { ...instanceBase, instanceId: 'i2', worldName: null, thumbnailUrl: null }
      } as Friend
    ]

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

    // Refetch replaces presence/status wholesale, but known world names survive
    // when the worldId is unchanged.
    await waitFor(() => {
      const data = queryClient.getQueryData<Friend[]>(friendsQueryKey('vrchat'))
      const friend = data?.[0]
      expect(friend?.displayName).toBe('Refetched')
      expect(friend?.status).toBe('ask-me')
      expect(friend?.presence.state).toBe('in-game')
      expect(friend?.instance?.instanceId).toBe('i2')
      expect(friend?.instance?.worldName).toBe('Known World')
      expect(friend?.instance?.thumbnailUrl).toBe('https://example.com/know.jpg')
    })

    expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' })
  })

  it('discards a current-buster payload when a persisted friend is malformed', async () => {
    const payload = buildPersistedPayload([
      {
        platform: 'vrchat',
        platformUserId: 'usr_malformed',
        displayName: 'Malformed Friend'
      } as unknown as Friend
    ])
    await seedPersistedCache(payload)
    const getFriends = vi.fn().mockResolvedValue([])
    Object.assign(window, { vrx: { getFriends } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    mountFriendsListHydrate(queryClient)

    await waitFor(() => expect(screen.getByText('No friends online')).toBeTruthy())
    expect(screen.queryByText('Malformed Friend')).toBeNull()
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })
})
