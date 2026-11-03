// @vitest-environment jsdom
/**
 * Hot Instances page (owner, 2026-10-18): every hot instance, most friends
 * first, as picture cards, with the shared header, empty state and sheet. The
 * Dashboard switch never hides the page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
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
    // The top bar holds the page's heading; the cards' headings sit under this one.
    const section = screen.getByRole('region', { name: msg('dashboard.sectionHotInstances') })
    expect(
      within(section).getByRole('heading', { level: 2, name: msg('dashboard.sectionHotInstances') })
    ).toBeTruthy()
    expect(within(section).getAllByRole('heading', { level: 3 })).toHaveLength(8)
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

  it("shows loading, not the empty state, while a sign-in's placeholder roster loads", () => {
    useFriendsMock.mockImplementation(() => ({
      data: [],
      isPending: false,
      isFetching: true,
      dataUpdatedAt: 0
    }))
    render(<HotInstancesView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
    expect(screen.queryByText(msg('dashboard.emptyHeading'))).toBeNull()
  })

  it('names a platform whose roster failed while the other loaded', () => {
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? { data: crowd('Lake', 3), isPending: false, dataUpdatedAt: 5 }
        : { data: [], isPending: false, isError: true, dataUpdatedAt: 0, refetch: vi.fn() }
    )
    render(<HotInstancesView />)
    // A failed first read keeps only the placeholder, so it is missing, not stale.
    expect(
      screen.getByText(
        msg('dashboard.sourceState.missing', { platform: msg('dashboard.platformCvr') })
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /Lake hot instance details/ })).toBeTruthy()
  })

  it('ignores a signed-out platform when the other fails, and retries only the enabled one', () => {
    const vrcRefetch = vi.fn()
    const cvrRefetch = vi.fn()
    useFriendsMock.mockImplementation((platform: string) =>
      platform === 'vrchat'
        ? { data: undefined, isPending: false, isError: true, isEnabled: true, refetch: vrcRefetch }
        : { data: undefined, isPending: true, isEnabled: false, refetch: cvrRefetch }
    )
    render(<HotInstancesView />)
    expect(screen.getByText(msg('dashboard.error'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: msg('dashboard.retry') }))
    expect(vrcRefetch).toHaveBeenCalledTimes(1)
    expect(cvrRefetch).not.toHaveBeenCalled()
  })
})
