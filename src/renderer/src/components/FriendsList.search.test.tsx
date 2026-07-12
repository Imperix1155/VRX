// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
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

function friend(name: string, state: Friend['presence']['state'] = 'active'): Friend {
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

function mockFriends(friends: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? friends : [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
}

async function finishDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  mockFriends([friend('José'), friend('Alice')])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useFriendsMock.mockReset()
})

describe('FriendsList search (VRX-65)', () => {
  it('controls the input instantly but applies the filter after 200ms', async () => {
    render(<FriendsList />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search friends' })

    fireEvent.change(input, { target: { value: 'jose' } })
    expect(input.value).toBe('jose')
    expect(useFriendsStore.getState().search).toBe('jose')
    expect(screen.getByText('Alice')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(screen.getByText('Alice')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.getByText('José').className).toContain('color-mix')
  })

  it('shows no-results copy and clearing restores the full list immediately', async () => {
    render(<FriendsList />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search friends' }), {
      target: { value: 'nobody' }
    })
    await finishDebounce()

    expect(screen.getByText('No friends match your search')).toBeTruthy()
    const clear = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clear)

    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(screen.getByText('José')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it('ignores section collapse during search and restores it after clear', async () => {
    mockFriends([friend('Zed', 'offline'), friend('Alice')])
    render(<FriendsList />)
    const offlineHeader = screen.getByRole('button', { name: /Offline/ })
    expect(offlineHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Zed')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search friends' }), {
      target: { value: 'zed' }
    })
    await finishDebounce()

    expect(offlineHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Zed')).toBeTruthy()
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toEqual(['offline'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(offlineHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Zed')).toBeNull()
    expect(useSettingsStore.getState().settings.collapsedFriendSections).toEqual(['offline'])
  })

  it('focuses search with slash unless focus is already in an editable control', () => {
    const { container } = render(
      <div>
        <input aria-label="Other input" />
        <textarea aria-label="Other textarea" />
        <FriendsList />
      </div>
    )
    const searchInput = screen.getByRole('textbox', { name: 'Search friends' })

    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(searchInput)

    const otherInput = screen.getByRole('textbox', { name: 'Other input' })
    otherInput.focus()
    fireEvent.keyDown(otherInput, { key: '/' })
    expect(document.activeElement).toBe(otherInput)

    const otherTextarea = screen.getByRole('textbox', { name: 'Other textarea' })
    otherTextarea.focus()
    fireEvent.keyDown(otherTextarea, { key: '/' })
    expect(document.activeElement).toBe(otherTextarea)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    container.append(editable)
    editable.focus()
    fireEvent.keyDown(editable, { key: '/' })
    expect(document.activeElement).toBe(editable)
  })
})
