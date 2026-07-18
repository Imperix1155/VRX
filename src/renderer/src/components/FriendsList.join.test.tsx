// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
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

const publicInstance: InstanceInfo = {
  worldId: 'wrld_fixture',
  instanceId: 'wrld_fixture:12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  region: 'us',
  userCount: 14
}

const joinableFriend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance: publicInstance,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
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

let joinInstance: ReturnType<typeof vi.fn>

beforeEach(() => {
  joinInstance = vi.fn().mockResolvedValue({ ok: true })
  window.vrx = { joinInstance } as unknown as Window['vrx']
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  mockFriends([joinableFriend])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useFriendsMock.mockReset()
})

describe('FriendsList join pill (VRX-166)', () => {
  it('renders a joinable friend pill as a button with the translated accessible name', () => {
    render(<FriendsList />)

    const button = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    expect(button.textContent).toBe('Public')
  })

  it.each([
    ['private', { ...joinableFriend, instance: null } satisfies Friend, 'Private'],
    [
      'offline instance',
      {
        ...joinableFriend,
        platform: 'chilloutvr',
        presence: { state: 'in-game' },
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: { ...publicInstance, type: 'offline' }
      } satisfies Friend,
      'Offline Instance'
    ],
    ['Ask Me VRChat', { ...joinableFriend, status: 'ask-me' } satisfies Friend, 'Private']
  ])('keeps a non-joinable %s pill as a span', (_case, friend, label) => {
    mockFriends([friend])
    const { container } = render(<FriendsList />)

    expect(screen.queryByRole('button', { name: /Join .* in / })).toBeNull()
    expect([...container.querySelectorAll('span')].some((span) => span.textContent === label)).toBe(
      true
    )
  })

  it('stops propagation and calls the bridge exactly once with the desktop join request', async () => {
    const bubbledClick = vi.fn()
    render(
      <div onClick={bubbledClick}>
        <FriendsList />
      </div>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
      await Promise.resolve()
    })

    expect(bubbledClick).not.toHaveBeenCalled()
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
  })

  it('ignores a second activation while a join is pending and keeps the pill label after success', async () => {
    let resolveJoin!: (result: { ok: true }) => void
    joinInstance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve
        })
    )
    render(<FriendsList />)

    const button = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(joinInstance).toHaveBeenCalledOnce()
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      resolveJoin({ ok: true })
      await Promise.resolve()
    })

    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText("Couldn't join")).toBeNull()
    expect(button.textContent).toBe('Public')
  })

  it('announces a denied join in a sibling status node without changing the button label', async () => {
    vi.useFakeTimers()
    joinInstance.mockResolvedValue({ ok: false, reason: 'not-joinable' })
    render(<FriendsList />)

    const button = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')

    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })

    expect(status.textContent).toBe("Couldn't join")
    expect(button.getAttribute('aria-label')).toBe('Join Alex in The Great Pug')
    expect(button.textContent).toBe('Public')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499)
    })
    expect(status.textContent).toBe("Couldn't join")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(status.textContent).toBe('')
  })

  it('a denied join blips ONLY the failed friend’s pill, not other rows (VRX-69 re-review)', async () => {
    joinInstance.mockResolvedValue({ ok: false, reason: 'not-joinable' })
    const bea: Friend = { ...joinableFriend, platformUserId: 'usr_bea', displayName: 'Bea' }
    mockFriends([joinableFriend, bea])
    render(<FriendsList />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
      await Promise.resolve()
    })

    const statusOf = (joinName: string): string => {
      const row = screen.getByRole('button', { name: joinName }).closest('li')
      return row?.querySelector('[role="status"]')?.textContent ?? ''
    }
    expect(statusOf('Join Alex in The Great Pug')).toBe("Couldn't join")
    expect(statusOf('Join Bea in The Great Pug')).toBe('') // Bea does NOT blip
  })

  it('falls back to the visible pill label in the accessible name when worldName is null', () => {
    mockFriends([{ ...joinableFriend, instance: { ...publicInstance, worldName: null } }])
    render(<FriendsList />)

    expect(screen.getByRole('button', { name: 'Join Alex in Public' })).toBeTruthy()
  })
})
