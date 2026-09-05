// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Friend, Platform } from '@shared/types'
import type { LinkedProfile } from '@shared/linkedProfiles'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import { useFriendsStore } from '../stores/friends'
import { fullFriend } from '../test-utils/friendFixture'
import TopBar from './TopBar'

const friends = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => vi.fn())
const profiles = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (original) => ({
  ...(await original<typeof import('../queries/friends')>()),
  useFriends: friends
}))
vi.mock('../queries/auth', () => ({ useAuthStatus: auth }))
vi.mock('../queries/linkedProfiles', () => ({ useLinkedProfiles: profiles }))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

function online(platform: Platform, id: string): Friend {
  const value = fullFriend(id, platform)
  return platform === 'vrchat'
    ? ({ ...value, platformUserId: id, presence: { state: 'active' } } as Friend)
    : { ...value, platformUserId: id, presence: { state: 'in-game' } }
}
function profile(): LinkedProfile {
  return {
    id: 'person',
    members: [
      { platform: 'vrchat', platformAccountId: 'vrchat-account', friendId: 'vrc' },
      { platform: 'chilloutvr', platformAccountId: 'chilloutvr-account', friendId: 'cvr' }
    ],
    customName: null,
    defaultName: 'Person',
    preferredPlatform: 'vrchat',
    pictureMode: 'preferred',
    sharedNote: '',
    revision: 1
  }
}
beforeEach(() => {
  friends.mockImplementation((platform: Platform) => ({
    data: platform === 'vrchat' ? [online('vrchat', 'vrc')] : [online('chilloutvr', 'cvr')]
  }))
  auth.mockImplementation((platform: Platform) => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-account`,
      displayName: 'Owner'
    }
  }))
  profiles.mockReturnValue({
    data: {
      profiles: [profile()],
      accountIds: { vrchat: 'vrchat-account', chilloutvr: 'chilloutvr-account' }
    }
  })
  useUiStore.setState({ activeTab: 'friends' })
  useFriendsStore.setState({ platformFilter: 'all', search: '' })
})
afterEach(() => {
  cleanup()
  friends.mockReset()
  auth.mockReset()
  profiles.mockReset()
})
describe('TopBar linked people count', () => {
  it.each(['vrchat', 'chilloutvr', 'both'])(
    'keeps a single linked person through %s auth errors using main-owned scopes',
    (failed) => {
      profiles.mockReturnValue({
        data: {
          profiles: [profile()],
          accountIds: { vrchat: 'vrchat-account', chilloutvr: 'chilloutvr-account' }
        }
      })
      const view = render(<TopBar />)
      auth.mockImplementation((platform: Platform) => ({
        data:
          failed === 'both' || failed === platform
            ? { platform, state: 'error', accountId: null }
            : { platform, state: 'authenticated', accountId: `${platform}-account` }
      }))
      view.rerender(<TopBar />)
      expect(screen.getByText(i18n.t('shell.onlineCount', { count: 1 }))).toBeTruthy()
    }
  )
  it('counts a linked active pair as one person in Friends across every platform filter', () => {
    useFriendsStore.setState({ search: 'no matching account name' })
    const view = render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 1 }))).toBeTruthy()
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    view.rerender(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 1 }))).toBeTruthy()
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    view.rerender(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 1 }))).toBeTruthy()
  })
  it('does not count offline linked people as online', () => {
    friends.mockImplementation((platform: Platform) => ({
      data:
        platform === 'vrchat'
          ? [{ ...online('vrchat', 'vrc'), presence: { state: 'offline' } }]
          : [{ ...online('chilloutvr', 'cvr'), presence: { state: 'offline' } }]
    }))
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 0 }))).toBeTruthy()
  })
  it('does not link accounts owned by a different authenticated user', () => {
    const wrongOwner = profile()
    wrongOwner.members[0] = {
      ...wrongOwner.members[0],
      platformAccountId: 'different-vrchat-account'
    }
    profiles.mockReturnValue({
      data: {
        profiles: [wrongOwner],
        accountIds: { vrchat: 'vrchat-account', chilloutvr: 'chilloutvr-account' }
      }
    })
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 2 }))).toBeTruthy()
  })
  it('keeps Dashboard account based and ignores search', () => {
    useFriendsStore.setState({ search: 'no match' })
    useUiStore.setState({ activeTab: 'dashboard' })
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 2 }))).toBeTruthy()
  })
})
