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
  it('lists only starred friends in game under Favorites, and keeps them in their own group too', () => {
    // Favorites read the signed-in account from the shared client's auth cache.
    queryClient.setQueryData(['auth-status', 'vrchat'], {
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'vrchat-test',
      displayName: 'Test User'
    })
    queryClient.setQueryData(['favorite-friends', 'vrchat', 'vrchat-test'], {
      friendIds: ['usr_Ben', 'usr_Cleo', 'usr_Zed'],
      revision: { platformAccountId: 'vrchat-test', epoch: 1 }
    })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] },
      dirty: false
    })
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [
              mk('Anna', 'in-game'),
              mk('Ben', 'in-game'),
              mk('Cleo', 'active'),
              mk('Zed', 'offline')
            ],
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
    // Ben is in game: under Favorites AND In-Game. Cleo is online: only Online.
    expect(headers).toEqual(['Favorites (1)', 'In-Game (2)', 'Online (1)', 'Offline (1)'])
    const favorites = screen.getByRole('button', { name: 'Favorites (1)' })
    const inGame = screen.getByRole('button', { name: 'In-Game (2)' })
    const [favoriteBen, inGameBen] = screen.getAllByText('Ben')
    expect(screen.getAllByText('Ben')).toHaveLength(2)
    expect(screen.getAllByText('Cleo')).toHaveLength(1)
    expect(
      favorites.compareDocumentPosition(favoriteBen!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      favoriteBen!.compareDocumentPosition(inGame) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      inGame.compareDocumentPosition(inGameBen!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // Both copies, and the online and offline favorites, carry the star.
    for (const name of [
      favoriteBen!,
      inGameBen!,
      screen.getByText('Cleo'),
      screen.getByText('Zed')
    ]) {
      expect(name.closest('li')!.querySelector('[data-favorite-mark]')).not.toBeNull()
    }
    expect(screen.getByText('Anna').closest('li')!.querySelector('[data-favorite-mark]')).toBeNull()

    // Collapsing Favorites is remembered like any other section, and Ben stays
    // in In-Game.
    fireEvent.click(favorites)
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toEqual(['favorites'])
    expect(screen.getAllByText('Ben')).toHaveLength(1)
  })

  it('shows no Favorites section while no starred friend is in game', () => {
    queryClient.setQueryData(['auth-status', 'vrchat'], {
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'vrchat-test',
      displayName: 'Test User'
    })
    queryClient.setQueryData(['favorite-friends', 'vrchat', 'vrchat-test'], {
      friendIds: ['usr_Cleo'],
      revision: { platformAccountId: 'vrchat-test', epoch: 1 }
    })
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? {
            data: [mk('Anna', 'in-game'), mk('Cleo', 'active')],
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn()
          }
        : { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() }
    )
    render(<FriendsList />)
    expect(screen.queryByRole('button', { name: /^Favorites/ })).toBeNull()
    expect(
      screen.getByText('Cleo').closest('li')!.querySelector('[data-favorite-mark]')
    ).not.toBeNull()
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

  it('offers the order choices above the search and remembers the pick', () => {
    useFriendsMock.mockImplementation(() => ({
      data: [],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    }))
    render(<FriendsList />)
    const order = screen.getByRole('radiogroup', { name: 'Order inside each group' })
    const choices = Array.from(order.querySelectorAll('[role="radio"]')).map(
      (radio) => radio.textContent
    )
    expect(choices).toEqual(['Name', 'Recent', 'World', 'Joinable'])
    expect(screen.getByRole('radio', { name: 'Name' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'World' }))
    expect(useSettingsStore.getState().settings.friendSort).toBe('world')
    // The control sits before Search friends.
    expect(
      order.compareDocumentPosition(screen.getByRole('textbox', { name: 'Search friends' })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('drops Recent while the Activity page is off and orders by name', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, showActivityPage: false, friendSort: 'recent' },
      dirty: false
    })
    useFriendsMock.mockImplementation(() => ({
      data: [],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    }))
    render(<FriendsList />)
    expect(screen.queryByRole('radio', { name: 'Recent' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Name' }).getAttribute('aria-checked')).toBe('true')
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
