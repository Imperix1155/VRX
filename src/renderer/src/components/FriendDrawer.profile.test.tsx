// @vitest-environment jsdom
/**
 * Friend details → Show full profile: the drawer already shows a VRChat
 * friend's trust rank above the profile, so it asks the profile to leave its
 * Rank row out; a ChilloutVR friend's rank shows only in the profile, so it
 * stays. Everyone here is on the friends list, so the profile offers no
 * friend action, and it hears when the card closes.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useProfileSelection } from '../stores/profileSelection'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import FriendsList from './FriendsList'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: Platform) => ({
    data: { platform, state: 'authenticated', accountId: `${platform}-test`, displayName: 'Me' }
  })
}))
// The profile has its own tests (CommunityPages.test.tsx); here only what the
// drawer asks of it matters.
vi.mock('./ProfileDetails', () => ({
  default: ({
    platform,
    showTrust,
    showFriendAction,
    showUserId,
    panelOpen
  }: {
    platform: Platform
    userId: string
    showTrust?: boolean
    showFriendAction?: boolean
    showUserId?: boolean
    panelOpen?: boolean
  }) => (
    <p data-testid={`profile-${platform}`}>
      <span data-testid="show-trust">{`showTrust=${String(showTrust)}`}</span>
      <span data-testid="show-friend-action">{`showFriendAction=${String(showFriendAction)}`}</span>
      <span data-testid="show-user-id">{`showUserId=${String(showUserId)}`}</span>
      <span data-testid="panel-open">{`panelOpen=${String(panelOpen)}`}</span>
    </p>
  )
}))

const instance: InstanceInfo = {
  worldId: 'wrld_fixture',
  instanceId: 'wrld_fixture:12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  groupId: null,
  groupImageUrl: null,
  region: 'us',
  userCount: 14
}

const vrcFriend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance,
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
  instance: { ...instance, type: 'friends-of-friends' },
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

beforeEach(() => {
  useFriendsMock.mockImplementation((platform: Platform) => ({
    data: [vrcFriend, cvrFriend].filter((friend) => friend.platform === platform),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
  window.vrx = {
    joinInstance: vi.fn().mockResolvedValue({ ok: true }),
    getFriendNote: vi
      .fn()
      .mockResolvedValue({ note: null, revision: { platformAccountId: 'self', epoch: 1 } }),
    setFriendNote: vi.fn().mockResolvedValue({ ok: true }),
    getAvatar: vi.fn().mockResolvedValue(null)
  } as unknown as Window['vrx']
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, dirty: false })
})

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
})

let rerender: (ui: React.ReactNode) => void

function openFullProfile(name: string): HTMLElement {
  ;({ rerender } = render(<FriendsList />))
  fireEvent.click(
    screen.getByRole('button', {
      name: (accessible) => accessible === name || accessible.startsWith(`${name} `)
    })
  )
  const drawer = screen.getByRole('dialog')
  fireEvent.click(within(drawer).getByRole('button', { name: i18n.t('drawer.fullProfile.show') }))
  return drawer
}

describe('friend details full profile', () => {
  it('does not repeat the VRChat trust rank shown above the profile', () => {
    const drawer = openFullProfile('Alex')
    expect(drawer.textContent).toContain(i18n.t('drawer.trustRank.known'))
    expect(within(drawer).getByTestId('show-trust').textContent).toBe('showTrust=false')
  })

  it('keeps the rank in a ChilloutVR profile, where nothing above shows it', () => {
    const drawer = openFullProfile('Mika')
    expect(within(drawer).getByTestId('show-trust').textContent).toBe('showTrust=true')
  })

  it.each(['Alex', 'Mika'])(
    'offers no friend action in %s’s profile: everyone here is a friend',
    (name) => {
      const drawer = openFullProfile(name)
      expect(within(drawer).getByTestId('show-friend-action').textContent).toBe(
        'showFriendAction=false'
      )
    }
  )

  it.each(['Alex', 'Mika'])(
    'asks %s’s profile for the user ID and its Copy link button',
    (name) => {
      const drawer = openFullProfile(name)
      expect(within(drawer).getByTestId('show-user-id').textContent).toBe('showUserId=true')
    }
  )

  it('tells the profile when the card closes because the friend left the list', () => {
    const drawer = openFullProfile('Alex')
    expect(within(drawer).getByTestId('panel-open').textContent).toBe('panelOpen=true')
    useFriendsMock.mockImplementation((platform: Platform) => ({
      data: [cvrFriend].filter((friend) => friend.platform === platform),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    }))
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The card stays mounted while it slides away, holding the closed state.
    expect(within(drawer).getByTestId('panel-open').textContent).toBe('panelOpen=false')
  })
})
