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
import FriendsList from './FriendsList'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
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

describe('FriendsList presence sections — interaction (VRX-67)', () => {
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
