// @vitest-environment jsdom
/**
 * Explore → Favorites renews an expired card from both lists it shows: VRX's
 * stars and the account's own favorite worlds (main answers those from memory
 * with fresh references).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorld } from '@shared/explore'
import type { GameFavoritesResult } from '@shared/gameFavorites'
import type { Platform } from '@shared/types'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import type { RecoverWorlds } from '../hooks/useExploreWorldSelection'
import ExploreFavorites from './ExploreFavorites'

const lastRecover: { current: RecoverWorlds | null } = { current: null }

vi.mock('./WorldResults', () => ({
  default: ({
    worlds,
    recover
  }: {
    worlds: readonly ExploreWorld[]
    recover: RecoverWorlds
  }): React.JSX.Element => {
    lastRecover.current = recover
    return <div data-testid="world-results">{worlds.map((w) => w.name).join(',')}</div>
  }
}))

function world(worldId: string, worldRef: string): ExploreWorld {
  return {
    platform: 'vrchat',
    worldId,
    worldRef,
    name: worldId,
    thumbnailUrl: null,
    activity: { state: 'unknown', value: null, source: 'unknown' },
    visibleRoomCount: { state: 'unknown', value: null, source: 'unknown' },
    popularity: null,
    sourceOrder: 0
  }
}

let gameRef: string
const revision = (platform: Platform): { platformAccountId: string; epoch: number } => ({
  platformAccountId: `${platform}-me`,
  epoch: 1
})

beforeEach(() => {
  gameRef = 'ref-old'
  queryClient.setQueryData(['auth-status', 'vrchat'], {
    platform: 'vrchat',
    state: 'authenticated',
    accountId: 'vrchat-me',
    displayName: 'Me'
  })
  useFriendsStore.setState({ platformFilter: 'vrchat' })
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, useGameFavorites: true }
  }))
  window.vrx = {
    getFavoriteWorlds: vi.fn(async ({ platform }: { platform: Platform }) => ({
      worlds: [world('wrld_star', 'ref-star')],
      revision: revision(platform)
    })),
    getGameFavorites: vi.fn(
      async ({ platform }: { platform: Platform }): Promise<GameFavoritesResult> => ({
        state: 'ready',
        revision: revision(platform),
        favorites: {
          oneGroupPerItem: true,
          groups: { friend: [], world: [] },
          friends: {},
          worlds: { wrld_game: ['world:worlds1'] },
          worldList: [world('wrld_game', gameRef)]
        }
      })
    )
  } as unknown as Window['vrx']
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  lastRecover.current = null
})

describe('Explore → Favorites recovery', () => {
  it("renews a game favorite world's reference, without a Refresh", async () => {
    render(<ExploreFavorites />)
    expect((await screen.findByTestId('world-results')).textContent).toContain('wrld_game')
    gameRef = 'ref-new'
    const renewed = await lastRecover.current!('vrchat')
    expect(renewed.map((w) => w.worldRef)).toEqual(['ref-star', 'ref-new'])
    // An ordinary read: main answers from memory, never a Refresh.
    expect(window.vrx!.getGameFavorites).toHaveBeenLastCalledWith({ platform: 'vrchat' })
  })
})
