// @vitest-environment jsdom
/**
 * FriendsList presence-section interaction tests (VRX-67).
 *
 * The SSR-rendered FriendsList.test.ts pins the static markup (grouping, counts,
 * initial aria-expanded) with mocked stores — `renderToStaticMarkup` never sees
 * a zustand `setState`, so it can't exercise clicking. This file renders with
 * `@testing-library/react` against the REAL `useSettingsStore` (only `useFriends`
 * is mocked, per the DashboardView.test.tsx recipe) to prove a header click
 * actually toggles collapse and persists through `updateSettings`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { queryClient } from '../queries/queryClient'
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
  queryClient.clear()
  useFriendsMock.mockReset()
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})

describe('FriendsList presence sections — interaction (VRX-67)', () => {
  it('leads with starred friends who are on now; a starred offline friend keeps Offline', () => {
    // Favorites read the signed-in account from the shared client's auth cache.
    queryClient.setQueryData(['auth-status', 'vrchat'], {
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'vrchat-test',
      displayName: 'Test User'
    })
    queryClient.setQueryData(['favorite-friends', 'vrchat', 'vrchat-test'], {
      friendIds: ['usr_Ben', 'usr_Zed'],
      revision: { platformAccountId: 'vrchat-test', epoch: 1 }
    })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] },
      dirty: false
    })
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game'), mk('Ben', 'active'), mk('Zed', 'offline')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    const headers = screen
      .getAllByRole('button', { expanded: true })
      .map((button) => button.textContent)
    expect(headers).toEqual(['Favorites (1)', 'In-Game (1)', 'Online (0)', 'Offline (1)'])
    const favorites = screen.getByRole('button', { name: 'Favorites (1)' })
    const ben = screen.getByText('Ben')
    const anna = screen.getByText('Anna')
    // Ben sits under Favorites, before In-Game's Anna, and carries the star.
    expect(favorites.compareDocumentPosition(ben) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ben.compareDocumentPosition(anna) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ben.closest('li')!.querySelector('[data-favorite-mark]')).not.toBeNull()
    expect(anna.closest('li')!.querySelector('[data-favorite-mark]')).toBeNull()
    expect(
      screen.getByText('Zed').closest('li')!.querySelector('[data-favorite-mark]')
    ).not.toBeNull()

    // Collapsing Favorites is remembered like any other section.
    fireEvent.click(favorites)
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toEqual(['favorites'])
    expect(screen.queryByText('Ben')).toBeNull()
  })

  it('shows no Favorites section while nobody starred is on', () => {
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    expect(screen.queryByRole('button', { name: /^Favorites/ })).toBeNull()
  })

  it('starts with the Offline section collapsed by default (the persisted-settings default)', () => {
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game'), mk('Zed', 'offline')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    expect(screen.getByRole('button', { name: /Offline/ }).getAttribute('aria-expanded')).toBe(
      'false'
    )
    expect(screen.queryByText('Zed')).toBeNull() // collapsed section's row is not rendered
    expect(screen.getByText('Anna')).toBeTruthy() // In-Game (expanded by default) still shows
    for (const name of [/^In-Game/, /^Online/, /^Offline/]) {
      // The virtual stream is one list, not three section-owned objects.
      // aria-expanded carries disclosure state without a false shared target.
      expect(screen.getByRole('button', { name }).getAttribute('aria-controls')).toBeNull()
    }
  })

  it('clicking a section header expands it, shows its rows, and persists via updateSettings (marks dirty)', () => {
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Zed', 'offline')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    const offlineHeader = screen.getByRole('button', { name: /Offline/ })
    expect(offlineHeader.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(offlineHeader)

    expect(offlineHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Zed')).toBeTruthy()
    // The toggle rides the existing settings store — persistence to disk is
    // `useSettingsPersistence`'s job (mounted in App.tsx), not this component's.
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toEqual([])
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('clicking an expanded section collapses it and hides its rows again', () => {
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    const inGameHeader = screen.getByRole('button', { name: /In-Game/ })
    expect(inGameHeader.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(inGameHeader)

    expect(inGameHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Anna')).toBeNull()
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toContain('in-game')
  })

  it('section header counts update live as the friend data changes', () => {
    let vrchatFriends = [mk('Anna', 'in-game'), mk('Ben', 'in-game')]
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: vrchatFriends,
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    const { rerender } = render(<FriendsList />)
    expect(screen.getByRole('button', { name: /In-Game \(2\)/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Online \(0\)/ })).toBeTruthy()

    vrchatFriends = [mk('Chris', 'active'), mk('Drew', 'offline')]
    rerender(<FriendsList />)

    expect(screen.getByRole('button', { name: /In-Game \(0\)/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Online \(1\)/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Offline \(1\)/ })).toBeTruthy()
  })
})
