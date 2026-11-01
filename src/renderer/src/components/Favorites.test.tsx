// @vitest-environment jsdom
/**
 * Favorite friends and worlds (owner, 2026-11-01): the friend details star
 * (a linked person is one star), the world sheet star, and Explore →
 * Favorites. Stars are kept only in VRX; these talk to main's local store.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorld } from '@shared/explore'
import type { Friend, Platform } from '@shared/types'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import { useFriendsStore } from '../stores/friends'
import FriendFavoriteStar from './FriendFavoriteStar'
import WorldFavoriteStar from './WorldFavoriteStar'
import ExploreFavorites from './ExploreFavorites'

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

function friend(platform: Platform, platformUserId: string): Friend {
  return {
    platformUserId,
    platform,
    displayName: 'Alex',
    avatarUrl: null,
    presence: { state: 'active' },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as Friend
}

function world(platform: Platform, worldId: string, name: string): ExploreWorld {
  return {
    platform,
    worldId,
    worldRef: `ref-${worldId}`,
    name,
    thumbnailUrl: null,
    activity: { state: 'unknown', value: null, source: 'unknown' },
    visibleRoomCount: { state: 'unknown', value: null, source: 'unknown' },
    popularity: null,
    sourceOrder: 0
  }
}

let friendStars: Record<Platform, Set<string>>
let worldStars: Record<Platform, ExploreWorld[]>
const revision = (platform: Platform): { platformAccountId: string; epoch: number } => ({
  platformAccountId: `${platform}-me`,
  epoch: 1
})

function signIn(platform: Platform): void {
  queryClient.setQueryData(['auth-status', platform], {
    platform,
    state: 'authenticated',
    accountId: `${platform}-me`,
    displayName: 'Me'
  })
}

beforeEach(() => {
  friendStars = { vrchat: new Set(), chilloutvr: new Set() }
  worldStars = { vrchat: [], chilloutvr: [] }
  window.vrx = {
    getFavoriteFriends: vi.fn(async ({ platform }: { platform: Platform }) => ({
      friendIds: [...friendStars[platform]],
      revision: revision(platform)
    })),
    setFavoriteFriend: vi.fn(
      async (req: { platform: Platform; friendIds: string[]; favorite: boolean }) => {
        for (const id of req.friendIds) {
          if (req.favorite) friendStars[req.platform].add(id)
          else friendStars[req.platform].delete(id)
        }
        return { ok: true }
      }
    ),
    getFavoriteWorlds: vi.fn(async ({ platform }: { platform: Platform }) => ({
      worlds: worldStars[platform],
      revision: revision(platform)
    })),
    setFavoriteWorld: vi.fn(async () => ({ ok: false, reason: 'full' }))
  } as unknown as Window['vrx']
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  useFriendsStore.setState({ platformFilter: 'all' })
})

describe('favorite friends', () => {
  it('stars a linked person on both platforms with one press, and unstars both', async () => {
    signIn('vrchat')
    signIn('chilloutvr')
    friendStars.chilloutvr.add('cvr_alex')
    render(
      <FriendFavoriteStar
        accounts={[friend('vrchat', 'usr_alex'), friend('chilloutvr', 'cvr_alex')]}
        name="Alex"
      />
    )
    const star = await screen.findByRole('button', { name: 'Favorite Alex' })
    // Either account starred reads as starred.
    await waitFor(() => expect(star.getAttribute('aria-pressed')).toBe('true'))
    expect(star.getAttribute('title')).toBe('Remove from favorites')
    await act(async () => fireEvent.click(star))
    await waitFor(() => expect(star.getAttribute('aria-pressed')).toBe('false'))
    expect(friendStars.vrchat.size + friendStars.chilloutvr.size).toBe(0)
    await act(async () => fireEvent.click(star))
    await waitFor(() => expect(star.getAttribute('aria-pressed')).toBe('true'))
    expect([...friendStars.vrchat]).toEqual(['usr_alex'])
    expect([...friendStars.chilloutvr]).toEqual(['cvr_alex'])
  })

  it('cannot be pressed while signed out', async () => {
    render(<FriendFavoriteStar accounts={[friend('vrchat', 'usr_alex')]} name="Alex" />)
    const star = screen.getByRole('button', { name: 'Favorite Alex' })
    expect((star as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('favorite worlds', () => {
  it('rolls a refused star back and says why', async () => {
    signIn('vrchat')
    render(<WorldFavoriteStar world={world('vrchat', 'wrld_a', 'Sky')} />)
    const star = await screen.findByRole('button', { name: 'Favorite Sky' })
    await act(async () => fireEvent.click(star))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'You have 100 favorite worlds, the most VRX can keep. Remove one to add another.'
    )
    await waitFor(() => expect(star.getAttribute('aria-pressed')).toBe('false'))
  })

  it('keeps the star pressable when the first favorites read fails', async () => {
    signIn('vrchat')
    const bridge = window.vrx as unknown as Record<string, ReturnType<typeof vi.fn>>
    bridge.getFavoriteWorlds!.mockRejectedValue(new Error('rate_limited'))
    render(<WorldFavoriteStar world={world('vrchat', 'wrld_a', 'Sky')} />)
    const star = await screen.findByRole('button', { name: 'Favorite Sky' })
    await waitFor(() => expect((star as HTMLButtonElement).disabled).toBe(false))
    await act(async () => fireEvent.click(star))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "Couldn't save. Try again."
    )
    expect((star as HTMLButtonElement).disabled).toBe(false)
    expect(bridge.setFavoriteWorld).not.toHaveBeenCalled()
  })

  it('lists both platforms’ favorites alternately, and explains an empty list', async () => {
    signIn('vrchat')
    signIn('chilloutvr')
    worldStars.vrchat = [world('vrchat', 'wrld_a', 'Sky'), world('vrchat', 'wrld_b', 'Sea')]
    worldStars.chilloutvr = [world('chilloutvr', 'c-1', 'Moon')]
    render(<ExploreFavorites />)
    await screen.findByText('Sky')
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names).toEqual(['Sky', 'Moon', 'Sea'])
    cleanup()

    worldStars = { vrchat: [], chilloutvr: [] }
    queryClient.clear()
    signIn('vrchat')
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    render(<ExploreFavorites />)
    expect(
      await screen.findByText(
        'No favorite worlds yet. Open a world and press the star to keep it here.'
      )
    ).toBeTruthy()
  })
})
