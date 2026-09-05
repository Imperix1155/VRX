// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { fullFriend } from '../test-utils/friendFixture'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useProfileSelection } from '../stores/profileSelection'
import FriendsList from './FriendsList'

const mocks = vi.hoisted(() => ({ friends: vi.fn(), links: vi.fn() }))
vi.mock('../queries/friends', async (original) => ({
  ...(await original<typeof import('../queries/friends')>()),
  useFriends: mocks.friends
}))
vi.mock('../queries/linkedProfiles', async (original) => ({
  ...(await original<typeof import('../queries/linkedProfiles')>()),
  useLinkedProfiles: mocks.links
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: string) => ({
    data: { platform, state: 'authenticated', accountId: platform + '-owner' }
  })
}))
const vrc = {
  ...fullFriend('VRC alias', 'vrchat'),
  platform: 'vrchat' as const,
  presence: { state: 'in-game' as const },
  status: 'online' as const
}
const cvr: Friend = fullFriend('CVR alias', 'chilloutvr')
const profile: LinkedProfile = {
  id: 'pair',
  members: [
    { platform: 'vrchat', platformAccountId: 'vrchat-owner', friendId: vrc.platformUserId },
    { platform: 'chilloutvr', platformAccountId: 'chilloutvr-owner', friendId: cvr.platformUserId }
  ],
  preferredPlatform: 'vrchat',
  defaultName: 'VRC alias',
  customName: 'Combined',
  pictureMode: 'preferred',
  sharedNote: '',
  revision: 1
}
function roster(friends: Friend[]): void {
  mocks.friends.mockImplementation((platform: string) => ({
    data: friends.filter((f) => f.platform === platform),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
}
beforeEach(() => {
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] } })
  mocks.links.mockReturnValue({ data: { profiles: [profile], lease: 'lease' }, isError: false })
  roster([vrc, cvr])
})
afterEach(cleanup)
describe('linked roster integration', () => {
  it('renders both in-game accounts as one named person and selects a person target', () => {
    render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(list).getByRole('button', { name: /^Combined/ }))
    expect(useProfileSelection.getState().target).toMatchObject({
      kind: 'person',
      personId: 'pair'
    })
  })
  it('keeps mixed rows separate but counts one person', () => {
    roster([{ ...vrc, presence: { state: 'active' } }, cvr])
    render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('linked-person-count').textContent).toContain('1')
    fireEvent.click(within(list).getByRole('button', { name: /^CVR alias/ }))
    expect(useProfileSelection.getState().target).toMatchObject({
      kind: 'account',
      personId: 'pair',
      account: { platform: 'chilloutvr' }
    })
  })
  it('uses only the selected platform name and avatar in a platform filter', () => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    expect(within(list).queryByText('Combined')).toBeNull()
    expect(within(list).queryByText('VRC alias')).toBeNull()
    expect(within(list).getByText('CVR alias')).toBeTruthy()
  })
})
