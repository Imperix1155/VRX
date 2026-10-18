// @vitest-environment jsdom
/** FriendsList partial/stale roster notice (issue 368). Same mock recipe as FriendsList.sections.test.tsx. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import FriendsList from './FriendsList'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-test`,
      displayName: 'Test User'
    }
  })
}))

function mk(name: string, state: Friend['presence']['state']): Friend {
  return {
    platformUserId: `usr_${name}`,
    platform: 'vrchat',
    displayName: name,
    avatarUrl: null,
    presence: { state },
    status: 'online',
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})

describe('FriendsList partial roster notice (issue 368)', () => {
  it('keeps the list and names the platform that failed, with its own Retry', () => {
    const vrcRefetch = vi.fn()
    const cvrRefetch = vi.fn()
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vrcRefetch
          }
        : {
            data: undefined,
            isPending: false,
            isError: true,
            isFetching: false,
            refetch: cvrRefetch
          }
    )
    render(<FriendsList />)
    expect(screen.getByText('Anna')).toBeTruthy()
    expect(screen.queryByText('Could not load friends')).toBeNull()
    expect(
      screen.getByText('ChilloutVR friends could not load. This list is missing them.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry ChilloutVR' }))
    expect(cvrRefetch).toHaveBeenCalledOnce()
    expect(vrcRefetch).not.toHaveBeenCalled()
  })

  it('shows no notice when every platform loaded', () => {
    useFriendsMock.mockImplementation((platform: string) => ({
      data: platform === 'vrchat' ? [mk('Anna', 'in-game')] : [],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    }))
    render(<FriendsList />)
    expect(screen.queryByTestId('friends-source-notice')).toBeNull()
  })
})
