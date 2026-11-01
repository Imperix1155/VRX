// @vitest-environment jsdom
/**
 * Favorite friends and worlds (owner, 2026-11-01): the friend details star
 * (a linked person is one VRX star), the world sheet star, the account's own
 * game favorite groups in the same panel, and Explore → Favorites.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorld } from '@shared/explore'
import type { Friend, Platform } from '@shared/types'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import type { GameFavorites, GameFavoritesResult } from '@shared/gameFavorites'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
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
let game: Record<Platform, GameFavoritesResult>

function vrchatGame(overrides: Partial<GameFavorites> = {}): GameFavoritesResult {
  return {
    state: 'ready',
    revision: { platformAccountId: 'vrchat-me', epoch: 1 },
    favorites: {
      oneGroupPerItem: true,
      groups: {
        friend: [
          { key: 'friend:group_0', name: 'Besties', capacity: 150, count: 3 },
          { key: 'friend:group_1', name: 'Group 2', capacity: 150, count: 0 }
        ],
        world: [{ key: 'world:worlds1', name: 'Chill', capacity: 100, count: 1 }]
      },
      friends: {},
      worlds: { wrld_game: ['world:worlds1'] },
      worldList: [world('vrchat', 'wrld_game', 'Game Pick')],
      ...overrides
    }
  }
}

function chilloutGame(overrides: Partial<GameFavorites> = {}): GameFavoritesResult {
  return {
    state: 'ready',
    revision: { platformAccountId: 'chilloutvr-me', epoch: 1 },
    favorites: {
      oneGroupPerItem: false,
      groups: {
        friend: [],
        world: [
          { key: 'worlds_a', name: 'Hangouts', capacity: null, count: 0 },
          { key: 'worlds_b', name: 'Clubs', capacity: null, count: 0 }
        ]
      },
      friends: {},
      worlds: {},
      worldList: [],
      ...overrides
    }
  }
}
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
    setFavoriteWorld: vi.fn(async () => ({ ok: false, reason: 'full' })),
    getGameFavorites: vi.fn(async ({ platform }: { platform: Platform }) => game[platform]),
    setGameFavorite: vi.fn(
      async (req: { platform: Platform; kind: string; groupKey: string; on: boolean }) => ({
        ok: true,
        groups: req.on ? [req.groupKey] : []
      })
    )
  } as unknown as Window['vrx']
  game = { vrchat: { state: 'not-authenticated' }, chilloutvr: { state: 'not-authenticated' } }
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, useGameFavorites: true }
  }))
})

async function openMenu(name: string): Promise<HTMLElement> {
  const star = await screen.findByRole('button', { name: new RegExp(`^Favorites for ${name}`) })
  await act(async () => fireEvent.click(star))
  expect(star.getAttribute('aria-expanded')).toBe('true')
  return star
}

function choice(name: RegExp | string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name })
}

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
    const star = await openMenu('Alex')
    // Either account starred reads as starred.
    const vrx = choice('Star in VRX (this PC only)')
    await waitFor(() => expect(vrx.getAttribute('aria-pressed')).toBe('true'))
    expect(star.getAttribute('data-on')).toBe('true')
    expect(star.getAttribute('aria-label')).toBe('Favorites for Alex, starred')
    await act(async () => fireEvent.click(vrx))
    await waitFor(() => expect(vrx.getAttribute('aria-pressed')).toBe('false'))
    expect(friendStars.vrchat.size + friendStars.chilloutvr.size).toBe(0)
    expect(star.getAttribute('data-on')).toBe('false')
    await act(async () => fireEvent.click(vrx))
    await waitFor(() => expect(vrx.getAttribute('aria-pressed')).toBe('true'))
    expect([...friendStars.vrchat]).toEqual(['usr_alex'])
    expect([...friendStars.chilloutvr]).toEqual(['cvr_alex'])
  })

  it('cannot star while signed out, and shows no game section', async () => {
    render(<FriendFavoriteStar accounts={[friend('vrchat', 'usr_alex')]} name="Alex" />)
    await openMenu('Alex')
    expect(choice('Star in VRX (this PC only)').disabled).toBe(true)
    expect(screen.queryByText('VRChat favorites')).toBeNull()
  })

  it("puts a friend in one of the account's VRChat groups, one group at a time", async () => {
    signIn('vrchat')
    game.vrchat = vrchatGame()
    render(<FriendFavoriteStar accounts={[friend('vrchat', 'usr_alex')]} name="Alex" />)
    const star = await openMenu('Alex')
    const besties = await waitFor(() => choice(/Besties/))
    expect(besties.textContent).toContain('3/150')
    await act(async () => fireEvent.click(besties))
    expect(window.vrx!.setGameFavorite).toHaveBeenCalledWith({
      platform: 'vrchat',
      kind: 'friend',
      friendId: 'usr_alex',
      groupKey: 'friend:group_0',
      on: true,
      revision: { platformAccountId: 'vrchat-me', epoch: 1 }
    })
    await waitFor(() => expect(besties.getAttribute('aria-pressed')).toBe('true'))
    expect(besties.textContent).toContain('4/150')
    // A game favorite alone fills the star.
    expect(star.getAttribute('data-on')).toBe('true')
    // VRChat keeps a favorite in one group: the others wait until it leaves.
    expect(choice(/Group 2/).disabled).toBe(true)
    expect(screen.getByText(/VRChat keeps a favorite in one group/)).toBeTruthy()
  })

  it('rolls a refused game change back and says why', async () => {
    signIn('vrchat')
    game.vrchat = vrchatGame({
      groups: {
        friend: [{ key: 'friend:group_0', name: 'Besties', capacity: 150, count: 3 }],
        world: []
      }
    })
    const bridge = window.vrx as unknown as Record<string, ReturnType<typeof vi.fn>>
    bridge.setGameFavorite!.mockResolvedValue({ ok: false, reason: 'rate-limited' })
    render(<FriendFavoriteStar accounts={[friend('vrchat', 'usr_alex')]} name="Alex" />)
    await openMenu('Alex')
    const besties = await waitFor(() => choice(/Besties/))
    await act(async () => fireEvent.click(besties))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That was a lot of changes at once. Wait a moment, then try again.'
    )
    expect(besties.getAttribute('aria-pressed')).toBe('false')
    expect(besties.textContent).toContain('3/150')
  })

  it('reads nothing from the game while Use my game favorites is off', async () => {
    signIn('vrchat')
    game.vrchat = vrchatGame()
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, useGameFavorites: false }
    }))
    render(<FriendFavoriteStar accounts={[friend('vrchat', 'usr_alex')]} name="Alex" />)
    await openMenu('Alex')
    expect(screen.getByText('Showing your game favorites is off.')).toBeTruthy()
    expect(window.vrx!.getGameFavorites).not.toHaveBeenCalled()
  })
})

describe('favorite worlds', () => {
  it('rolls a refused star back and says why', async () => {
    signIn('vrchat')
    render(<WorldFavoriteStar world={world('vrchat', 'wrld_a', 'Sky')} />)
    await openMenu('Sky')
    const vrx = choice('Star in VRX (this PC only)')
    await act(async () => fireEvent.click(vrx))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'You have 100 favorite worlds, the most VRX can keep. Remove one to add another.'
    )
    await waitFor(() => expect(vrx.getAttribute('aria-pressed')).toBe('false'))
  })

  it('keeps the star pressable when the first favorites read fails', async () => {
    signIn('vrchat')
    const bridge = window.vrx as unknown as Record<string, ReturnType<typeof vi.fn>>
    bridge.getFavoriteWorlds!.mockRejectedValue(new Error('rate_limited'))
    render(<WorldFavoriteStar world={world('vrchat', 'wrld_a', 'Sky')} />)
    await openMenu('Sky')
    const vrx = choice('Star in VRX (this PC only)')
    await waitFor(() => expect(vrx.disabled).toBe(false))
    await act(async () => fireEvent.click(vrx))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "Couldn't save. Try again."
    )
    expect(vrx.disabled).toBe(false)
    expect(bridge.setFavoriteWorld).not.toHaveBeenCalled()
  })

  it('lets a ChilloutVR world sit in several categories, by its Explore reference', async () => {
    signIn('chilloutvr')
    game.chilloutvr = chilloutGame({ worlds: { 'c-1': ['worlds_a'] } })
    const bridge = window.vrx as unknown as Record<string, ReturnType<typeof vi.fn>>
    bridge.setGameFavorite!.mockResolvedValue({ ok: true, groups: ['worlds_a', 'worlds_b'] })
    render(<WorldFavoriteStar world={world('chilloutvr', 'c-1', 'Moon')} />)
    await openMenu('Moon')
    const clubs = await waitFor(() => choice(/Clubs/))
    expect(clubs.disabled).toBe(false)
    await act(async () => fireEvent.click(clubs))
    expect(bridge.setGameFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'world', worldRef: 'ref-c-1', groupKey: 'worlds_b' })
    )
    await waitFor(() => expect(clubs.getAttribute('aria-pressed')).toBe('true'))
    expect(choice(/Hangouts/).getAttribute('aria-pressed')).toBe('true')
  })

  it('says when the account has no groups yet', async () => {
    signIn('chilloutvr')
    game.chilloutvr = chilloutGame({ groups: { friend: [], world: [] } })
    render(<WorldFavoriteStar world={world('chilloutvr', 'c-1', 'Moon')} />)
    await openMenu('Moon')
    expect(
      await screen.findByText('No groups yet. Make one in the game, then check back.')
    ).toBeTruthy()
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

  it("adds the account's own favorite worlds after VRX's stars, once each", async () => {
    signIn('vrchat')
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    worldStars.vrchat = [world('vrchat', 'wrld_a', 'Sky')]
    game.vrchat = vrchatGame({
      worldList: [world('vrchat', 'wrld_a', 'Sky'), world('vrchat', 'wrld_game', 'Game Pick')]
    })
    render(<ExploreFavorites />)
    await screen.findByText('Game Pick')
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names).toEqual(['Sky', 'Game Pick'])
  })
})
