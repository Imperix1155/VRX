// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Friend, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import FriendsList from './FriendsList'
import DashboardView from './DashboardView'

const useFriendsMock = vi.hoisted(() => vi.fn())
const useAuthStatusMock = vi.hoisted(() => vi.fn())

vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({ useAuthStatus: useAuthStatusMock }))

const accountCta = 'Go to Accounts'

const socialSurfaces = [
  {
    name: 'Friends list',
    Component: FriendsList,
    loading: 'Loading...',
    error: 'Could not load friends'
  },
  {
    name: 'Dashboard',
    Component: DashboardView,
    loading: 'Loading...',
    error: 'Could not load your friends right now'
  }
] as const

const platforms = [
  ['vrchat', 'VRChat'],
  ['chilloutvr', 'ChilloutVR']
] as const

function setQueries(vrc: Record<string, unknown>, cvr: Record<string, unknown>): void {
  useFriendsMock.mockImplementation((platform: Platform) => (platform === 'vrchat' ? vrc : cvr))
}

function failedQuery(): Record<string, unknown> {
  return {
    data: undefined,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch: vi.fn()
  }
}

function loadingQuery(): Record<string, unknown> {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    isFetching: true,
    refetch: vi.fn()
  }
}

function connected(platform: Platform): void {
  useAuthStatusMock.mockReturnValue({
    data: { platform, state: 'authenticated', displayName: 'Test User' },
    isPending: false,
    isFetching: false
  })
}

function unauthenticated(platform: Platform): void {
  useAuthStatusMock.mockReturnValue({
    data: { platform, state: 'unauthenticated', displayName: null },
    isPending: false,
    isFetching: false
  })
}

function pendingAuth(): void {
  useAuthStatusMock.mockReturnValue({
    data: undefined,
    isPending: true,
    isFetching: true
  })
}

function refetchingUnauthenticated(platform: Platform): void {
  useAuthStatusMock.mockReturnValue({
    data: { platform, state: 'unauthenticated', displayName: null },
    isPending: false,
    isFetching: true
  })
}

function friend(platform: Platform): Friend {
  return {
    platform,
    platformUserId: `${platform}_friend`,
    displayName: 'Available Friend',
    avatarUrl: null,
    presence: { state: 'active' },
    status: platform === 'vrchat' ? 'online' : null,
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as Friend
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useFriendsMock.mockReset()
  useAuthStatusMock.mockReset()
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  useUiStore.setState({ activeTab: 'dashboard', settingsCategory: 'appearance' })
})

describe('not-connected social states (VRX-192)', () => {
  for (const { name, Component, loading, error } of socialSurfaces) {
    describe(name, () => {
      it.each(platforms)(
        'shows loading, not an error or CTA, while %s auth has no cached status',
        (platform) => {
          useFriendsStore.setState({ platformFilter: platform })
          setQueries(failedQuery(), failedQuery())
          pendingAuth()

          render(<Component />)

          expect(screen.getByText(loading)).toBeTruthy()
          expect(screen.queryByText(error)).toBeNull()
          expect(screen.queryByRole('button', { name: accountCta })).toBeNull()
        }
      )

      it.each(platforms)(
        'does not flash the CTA while stale unauthenticated %s auth is refetching after login',
        (platform) => {
          useFriendsStore.setState({ platformFilter: platform })
          setQueries(loadingQuery(), loadingQuery())
          refetchingUnauthenticated(platform)

          render(<Component />)

          expect(screen.getByText(loading)).toBeTruthy()
          expect(screen.queryByRole('button', { name: accountCta })).toBeNull()
        }
      )

      it.each(platforms)(
        'shows the %s account CTA once auth is settled unauthenticated',
        (platform, platformName) => {
          useFriendsStore.setState({ platformFilter: platform })
          setQueries(failedQuery(), failedQuery())
          unauthenticated(platform)

          render(<Component />)

          expect(screen.getByText(`Connect ${platformName} to see your friends here`)).toBeTruthy()
          expect(screen.queryByText(error)).toBeNull()
          expect(screen.getByRole('button', { name: accountCta })).toBeTruthy()
        }
      )
    })
  }

  it.each([
    ['Friends list', FriendsList],
    ['Dashboard', DashboardView]
  ] as const)('%s opens Accounts from the VRChat CTA', (_name, Component) => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    setQueries(failedQuery(), failedQuery())
    unauthenticated('vrchat')
    const setActiveTab = vi.spyOn(useUiStore.getState(), 'setActiveTab')
    const setSettingsCategory = vi.spyOn(useUiStore.getState(), 'setSettingsCategory')

    render(<Component />)

    expect(screen.getByText('Connect VRChat to see your friends here')).toBeTruthy()
    expect(screen.queryByText('Could not load friends')).toBeNull()
    expect(screen.queryByText('Could not load your friends right now')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: accountCta }))
    expect(setActiveTab).toHaveBeenCalledWith('settings')
    expect(setSettingsCategory).toHaveBeenCalledWith('accounts')
    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'settings',
      settingsCategory: 'accounts'
    })
  })

  it.each([
    ['Friends list', FriendsList],
    ['Dashboard', DashboardView]
  ] as const)('%s shows the ChilloutVR account CTA', (_name, Component) => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    setQueries(failedQuery(), failedQuery())
    unauthenticated('chilloutvr')

    render(<Component />)

    expect(screen.getByText('Connect ChilloutVR to see your friends here')).toBeTruthy()
    expect(screen.getByRole('button', { name: accountCta })).toBeTruthy()
  })

  it.each([
    ['Friends list', FriendsList, 'Could not load friends'],
    ['Dashboard', DashboardView, 'Could not load your friends right now']
  ] as const)(
    '%s keeps its failure state when the selected platform is connected',
    (_name, Component, error) => {
      useFriendsStore.setState({ platformFilter: 'vrchat' })
      setQueries(failedQuery(), failedQuery())
      connected('vrchat')

      render(<Component />)

      expect(screen.getByText(error)).toBeTruthy()
      expect(screen.queryByRole('button', { name: accountCta })).toBeNull()
    }
  )

  it.each([
    ['Friends list', FriendsList],
    ['Dashboard', DashboardView]
  ] as const)(
    '%s keeps rendering available data for All when one platform fails',
    (_name, Component) => {
      setQueries(
        {
          data: [friend('vrchat')],
          isPending: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn()
        },
        failedQuery()
      )
      connected('vrchat')

      render(<Component />)

      if (_name === 'Friends list') {
        expect(screen.getByText('Available Friend')).toBeTruthy()
      } else {
        expect(screen.getByText('Friends online')).toBeTruthy()
      }
      expect(screen.queryByRole('button', { name: accountCta })).toBeNull()
    }
  )
})
