// @vitest-environment jsdom
/**
 * FriendDrawer (VRX-69 phase 1) — integration-tested through FriendsList:
 * row click/Enter opens the dialog with THAT friend's data; Esc/scrim/✕ close
 * and restore focus; focus is trapped; the status band renders the privacy
 * tier in words + the right token (CVR online folds to Online); Join renders
 * only for joinable friends; Ask Me/DND show "Hidden".
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  statusDescription: 'come thru',
  instance: publicInstance,
  trustRank: 'known',
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

const cvrFriend: Friend = {
  platformUserId: 'cvr_mika',
  platform: 'chilloutvr',
  displayName: 'Mika',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: null,
  statusDescription: null,
  instance: { ...publicInstance, type: 'friends-of-friends' },
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

function mockFriends(friends: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) => ({
    data: friends.filter((f) => f.platform === platform),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
}

function openDrawerFor(name: string): HTMLElement {
  const row = screen.getByRole('button', { name: `Open details for ${name}` })
  fireEvent.click(row)
  return row
}

const dialog = (): HTMLElement => screen.getByRole('dialog')

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

describe('FriendDrawer (VRX-69)', () => {
  it('opens on row click with that friend’s data', () => {
    render(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()

    openDrawerFor('Alex')

    const panel = screen.getByRole('dialog', { name: 'Alex' })
    const scoped = within(panel)
    expect(scoped.getByText('come thru')).toBeTruthy() // custom status
    expect(scoped.getByText('VRChat')).toBeTruthy() // full-word platform pill
    expect(scoped.getByText('Online')).toBeTruthy() // status word
    expect(scoped.getByText('Around and reachable')).toBeTruthy() // descriptor
    expect(scoped.getByText('The Great Pug')).toBeTruthy() // WHERE world
    expect(scoped.getByText('Public')).toBeTruthy() // shared InstancePill
    expect(scoped.getByText('Trust: Known User')).toBeTruthy()
  })

  it('opens with Enter and with Space on a focused row', () => {
    render(<FriendsList />)
    const row = screen.getByRole('button', { name: 'Open details for Alex' })

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(row, { key: ' ' })
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
  })

  it('Esc closes and returns focus to the opening row', () => {
    render(<FriendsList />)
    const row = openDrawerFor('Alex')
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('scrim click closes; ✕ closes; focus returns to the row both ways', () => {
    render(<FriendsList />)
    let row = openDrawerFor('Alex')
    fireEvent.click(screen.getByTestId('friend-drawer-scrim'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)

    row = openDrawerFor('Alex')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('traps focus: initial focus lands in the drawer and Tab wraps both ways', () => {
    render(<FriendsList />)
    openDrawerFor('Alex')

    const closeButton = within(dialog()).getByRole('button', { name: 'Close' })
    const joinButton = within(dialog()).getByRole('button', { name: 'Join' })
    expect(document.activeElement).toBe(closeButton) // initial focus inside

    // Tab from the LAST focusable wraps to the first…
    joinButton.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    // …and Shift+Tab from the FIRST wraps to the last.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(joinButton)
  })

  it.each([
    ['join-me', 'Join Me', '--st-joinme', 'Open to joins — hop in freely'],
    ['online', 'Online', '--st-online', 'Around and reachable'],
    ['ask-me', 'Ask Me', '--st-askme', 'Ask before joining'],
    ['dnd', 'Do Not Disturb', '--st-dnd', 'Not accepting joins']
  ] as const)('status band renders %s in words + its token', (status, word, token, desc) => {
    mockFriends([{ ...joinableFriend, status }])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const wordEl = within(dialog()).getByText(word)
    expect(wordEl.getAttribute('style') ?? '').toContain(`var(${token}-text)`)
    expect(within(dialog()).getByText(desc)).toBeTruthy()
  })

  it('folds CVR online onto the tier-2 Online band (never the state palette)', () => {
    mockFriends([cvrFriend])
    render(<FriendsList />)
    openDrawerFor('Mika')

    const scoped = within(dialog())
    const wordEl = scoped.getByText('Online')
    expect(wordEl.getAttribute('style') ?? '').toContain('var(--st-online-text)')
    expect(scoped.getByText('ChilloutVR')).toBeTruthy()
    // CVR FoF instance resolves through the shared tier map (VRChat-scheme label).
    expect(scoped.getByText('Friends+')).toBeTruthy()
    // No fabricated CVR extras: no custom status, no trust line.
    expect(scoped.queryByText(/Trust:/)).toBeNull()
  })

  it('renders the Offline band for an offline friend, with no Join', () => {
    // The Offline section is collapsed by default — expand it to reach the row.
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] },
      dirty: false
    })
    mockFriends([
      { ...joinableFriend, status: null, presence: { state: 'offline' }, instance: null }
    ])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    expect(scoped.getByText('Offline')).toBeTruthy()
    expect(scoped.getByText('Not connected')).toBeTruthy()
    expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it.each([['ask-me'], ['dnd']] as const)(
    '%s shows "Hidden" as the world and no Join',
    (status) => {
      mockFriends([{ ...joinableFriend, status }])
      render(<FriendsList />)
      openDrawerFor('Alex')

      const scoped = within(dialog())
      expect(scoped.getByText('Hidden')).toBeTruthy()
      expect(scoped.queryByText('The Great Pug')).toBeNull()
      expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
    }
  )

  it('shows Join ONLY for joinable friends and reuses the row’s join flow', async () => {
    render(<FriendsList />)
    openDrawerFor('Alex')

    const joinButton = within(dialog()).getByRole('button', { name: 'Join' })
    await act(async () => {
      fireEvent.click(joinButton)
      await Promise.resolve()
    })
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
  })

  it('web-active friend gets no Join button and no WHERE world line', () => {
    mockFriends([
      { ...joinableFriend, presence: { state: 'active' }, instance: null, trustRank: null }
    ])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
    expect(scoped.queryByText('The Great Pug')).toBeNull()
    expect(scoped.queryByText('Where')).toBeNull()
  })

  it('announces a denied join via the drawer’s status blip', async () => {
    vi.useFakeTimers()
    joinInstance.mockResolvedValue({ ok: false, reason: 'not-joinable' })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    await act(async () => {
      fireEvent.click(scoped.getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })
    expect(scoped.getByRole('status').textContent).toBe("Couldn't join")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(scoped.getByRole('status').textContent).toBe('')
  })

  it('the "/" search shortcut does not steal focus while the drawer is open', () => {
    render(<FriendsList />)
    openDrawerFor('Alex')
    const closeButton = within(dialog()).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).toBe(closeButton) // trap holds

    // After closing, "/" works again.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: '/' })
    expect((document.activeElement as HTMLInputElement).placeholder).toBe('Search friends')
  })

  it('clears a stale selection when the friend leaves the roster (no surprise reopen)', () => {
    const { rerender } = render(<FriendsList />)
    openDrawerFor('Alex')
    expect(screen.getByRole('dialog')).toBeTruthy()

    mockFriends([]) // friend removed from the settled roster
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()

    mockFriends([joinableFriend]) // friend returns — the drawer must NOT reopen
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useFriendsStore.getState().selectedFriendId).toBeNull()
  })

  it('clicking the join pill inside the row does NOT open the drawer', async () => {
    render(<FriendsList />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
