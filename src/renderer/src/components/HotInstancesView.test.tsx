// @vitest-environment jsdom
/**
 * Hot Instances page (owner, 2026-10-18): every hot instance, most friends
 * first, as picture cards, with the shared header, empty state and sheet. The
 * Dashboard switch never hides the page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Friend, VrcFriend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import HotInstancesView from './HotInstancesView'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: 'authenticated', accountId: `${platform}-test`, displayName: 'Test' }
  })
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

function crowd(world: string, count: number): Friend[] {
  return Array.from({ length: count }, (_, i): VrcFriend => ({
    platform: 'vrchat',
    platformUserId: `${world}-${i}`,
    displayName: `${world} ${i}`,
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    trustRank: 'known',
    instance: {
      worldId: `wrld_${world}`,
      instanceId: `wrld_${world}:1~public`,
      worldName: world,
      thumbnailUrl: null,
      type: 'public',
      openness: 'public',
      isGroup: false,
      groupName: null,
      groupId: null,
      groupImageUrl: null,
      region: 'us',
      userCount: count
    },
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }))
}

function stub(vrc: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? vrc : [],
    isPending: false
  }))
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('HotInstancesView', () => {
  it('lists every hot instance, most friends first, as picture cards', () => {
    const worlds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    stub(worlds.flatMap((world, i) => crowd(world, 10 - i)))
    // The Dashboard switch only hides the Dashboard section.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, hotInstancesEnabled: false } })
    const { container } = render(<HotInstancesView />)
    const cards = screen.getAllByRole('button', { name: /hot instance details/ })
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(
      worlds.map((world) => msg('hotSheet.ariaLabel', { world }))
    )
    expect(container.querySelectorAll('[data-hot-card-layout="picture"]')).toHaveLength(8)
    expect(screen.getByRole('spinbutton')).toBeTruthy()
  })

  it('shows the empty state below the threshold', () => {
    stub(crowd('Solo', 1))
    render(<HotInstancesView />)
    expect(screen.getByText(msg('dashboard.emptyHeading'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: /hot instance details/ })).toBeNull()
  })

  it('opens the shared sheet from a card', () => {
    stub(crowd('Lake', 3))
    render(<HotInstancesView />)
    fireEvent.click(screen.getByRole('button', { name: /Lake hot instance details/ }))
    expect(screen.getByRole('dialog', { name: 'Lake' })).toBeTruthy()
  })
})
