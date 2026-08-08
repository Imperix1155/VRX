// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Friend, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import FriendsList from '../components/FriendsList'
import { useLiveFriendEvents } from '../hooks/useLiveFriendEvents'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import {
  buildCacheBuster,
  buildPersistOptions,
  onPersistRestore,
  QUERY_CACHE_STORAGE_KEY
} from './cache'

function staleFriend(): Friend {
  return {
    platformUserId: 'usr_stale',
    platform: 'vrchat',
    displayName: 'Stale In-Game Friend',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

function persistedRoster(friends: Friend[]): string {
  const now = Date.now()
  return JSON.stringify({
    buster: buildCacheBuster(),
    timestamp: now,
    clientState: {
      mutations: [],
      queries: [
        {
          dehydratedAt: now,
          queryHash: '["friends","vrchat"]',
          queryKey: ['friends', 'vrchat'],
          state: {
            data: friends,
            dataUpdateCount: 1,
            dataUpdatedAt: now,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'success',
            fetchStatus: 'idle'
          }
        }
      ]
    }
  })
}

function AppProbe(): React.JSX.Element {
  useLiveFriendEvents()
  return <FriendsList />
}

function stubBridge(getFriends: ReturnType<typeof vi.fn>): void {
  Object.assign(window, {
    vrx: {
      getAuthStatus: vi.fn(({ platform }: { platform: Platform }) =>
        Promise.resolve({
          platform,
          state: platform === 'vrchat' ? ('needs-2fa' as const) : ('unauthenticated' as const),
          accountId: null,
          displayName: null,
          ...(platform === 'vrchat' ? { twoFactorMethod: 'totp' as const } : {})
        })
      ),
      getFriends,
      onFriendEvent: () => () => {},
      onIdentityBoundary: () => () => {}
    }
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  Object.assign(window, { vrx: undefined })
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})

describe('persisted roster under disabled auth', () => {
  it('clears hydrated friends when auth settles to needs-2fa without dispatching getFriends', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, persistedRoster([staleFriend()]))
    const getFriends = vi.fn()
    stubBridge(getFriends)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={buildPersistOptions()}
        onSuccess={() => onPersistRestore(queryClient)}
      >
        <AppProbe />
      </PersistQueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText('No friends online')).toBeTruthy())
    expect(screen.queryByText('Stale In-Game Friend')).toBeNull()
    expect(getFriends).not.toHaveBeenCalled()
  })
})
