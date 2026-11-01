// @vitest-environment jsdom
/**
 * Search, Groups, Explore's New and Recently updated lists, the Dashboard's
 * "Playing now" line and the full profile (owner, 2026-10-31). VRChat and
 * ChilloutVR get the same tiles, notices and sheets; nothing is read before
 * the user asks, and a signed-out platform adds no request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  CommunityGroup,
  CommunitySearchResult,
  MyGroupsResult,
  PersonProfile,
  WorldListResult
} from '@shared/community'
import type { ExploreWorld } from '@shared/explore'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from '../i18n'
import { useFriendsStore } from '../stores/friends'
import { interleave } from '../utils/community'
import SearchView from './SearchView'
import GroupsView from './GroupsView'
import ExploreListPanel from './ExploreLists'
import TopBarCounts from './TopBarCounts'
import { usePlayerCounts } from '../hooks/usePlayerCounts'
import ProfileDetails from './ProfileDetails'

const avatarPicture = vi.hoisted(() => ({ current: null as string | null }))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => avatarPicture.current }))
// World cards and their sheet have their own tests (ExploreRoute.test.tsx).
const lastRecover = vi.hoisted(() => ({
  current: null as ((platform: Platform) => Promise<readonly ExploreWorld[]>) | null
}))
vi.mock('./WorldResults', () => ({
  default: ({
    worlds,
    recover
  }: {
    worlds: readonly ExploreWorld[]
    recover: (platform: Platform) => Promise<readonly ExploreWorld[]>
  }) => {
    lastRecover.current = recover
    return (
      <ul data-testid="world-results">
        {worlds.map((world) => (
          <li key={world.worldRef}>{`${world.platform}:${world.name}`}</li>
        ))}
      </ul>
    )
  }
}))
const authState = vi.hoisted(() => ({ vrchat: 'authenticated', chilloutvr: 'authenticated' }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: Platform) => {
    const state = authState[platform]
    const data: AuthStatus =
      state === 'authenticated'
        ? { platform, state, accountId: `${platform}-me`, displayName: 'Me' }
        : { platform, state: 'unauthenticated', accountId: null, displayName: null }
    return { data, isSuccess: true, isFetching: false, isPending: false }
  }
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)
const VRC_ID = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const CVR_ID = '5a3c1e2d-0000-4000-8000-000000000002'

function world(platform: Platform, index: number, name: string): ExploreWorld {
  return {
    platform,
    worldId: `${platform}-world-${index}`,
    worldRef: `ref-${platform}-${index}`,
    name,
    authorName: null,
    occupants: null
  } as unknown as ExploreWorld
}

function group(platform: Platform, name: string, role: CommunityGroup['role']): CommunityGroup {
  return {
    platform,
    groupId: `${platform}-${name}`,
    name,
    code: platform === 'vrchat' ? 'ABCDE.1234' : 'TAG',
    description: `${name} description`,
    imageUrl: null,
    bannerUrl: null,
    memberCount: 1200,
    role
  }
}

function profile(platform: Platform): PersonProfile {
  return {
    platform,
    userId: platform === 'vrchat' ? VRC_ID : CVR_ID,
    displayName: platform === 'vrchat' ? 'Lumen' : 'Ember',
    imageUrl: null,
    isFriend: true,
    pronouns: platform === 'vrchat' ? 'they/them' : null,
    bio: 'Hello there',
    rank:
      platform === 'vrchat'
        ? { kind: 'vrchat-trust', value: 'trusted' }
        : { kind: 'label', value: 'User' },
    badges: [{ name: 'Supporter', imageUrl: null }]
  }
}

const bridge = {
  searchCommunity: vi.fn(
    ({ platform, query }: { platform: Platform; query: string }): Promise<CommunitySearchResult> =>
      Promise.resolve({
        ok: true,
        platform,
        query,
        people: [
          {
            platform,
            userId: platform === 'vrchat' ? VRC_ID : CVR_ID,
            displayName: platform === 'vrchat' ? 'Lumen' : 'Ember',
            imageUrl: null,
            isFriend: platform === 'vrchat'
          }
        ],
        worlds: [world(platform, 1, `${platform} plaza`)]
      })
  ),
  getProfile: vi.fn(({ platform }: { platform: Platform }) =>
    Promise.resolve({ ok: true, profile: profile(platform) })
  ),
  getProfileWorlds: vi.fn(({ platform }: { platform: Platform }) =>
    Promise.resolve({
      ok: true,
      worlds: [{ platform, worldId: 'w1', name: 'Home Base', imageUrl: null }],
      complete: true
    })
  ),
  getProfileGroups: vi.fn(() => Promise.resolve({ ok: true, groups: [], complete: true })),
  sendFriendRequest: vi.fn(() => Promise.resolve({ ok: true })),
  answerFriendRequest: vi.fn(() => Promise.resolve({ ok: true })),
  getMyGroups: vi.fn(({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
    Promise.resolve({
      ok: true,
      platform,
      groups:
        platform === 'vrchat'
          ? [group('vrchat', 'Zephyr Club', 'member'), group('vrchat', 'Aurora', 'owner')]
          : [group('chilloutvr', 'Meadow', 'member')],
      complete: true
    })
  ),
  getWorldList: vi.fn(
    ({
      platform,
      list
    }: {
      platform: Platform
      list: 'new' | 'updated'
    }): Promise<WorldListResult> =>
      Promise.resolve({
        ok: true,
        platform,
        list,
        worlds: [world(platform, 1, `${platform} one`), world(platform, 2, `${platform} two`)]
      })
  ),
  getPlayersOnline: vi.fn(({ platform }: { platform: Platform }) =>
    Promise.resolve({
      ok: true,
      platform,
      count: platform === 'vrchat' ? 54321 : 1234,
      checkedAt: 1
    })
  )
}

function renderWith(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  Object.defineProperty(window, 'vrx', { value: bridge, configurable: true, writable: true })
  class Observer {
    observe = vi.fn()
    disconnect = vi.fn()
  }
  vi.stubGlobal('IntersectionObserver', Observer)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  authState.vrchat = 'authenticated'
  authState.chilloutvr = 'authenticated'
  lastRecover.current = null
  avatarPicture.current = null
  useFriendsStore.setState({ platformFilter: 'all' })
  Reflect.deleteProperty(window, 'vrx')
})

describe('interleave', () => {
  it('alternates the platforms and keeps each list in its own order', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1']])).toEqual(['a1', 'b1', 'a2', 'a3'])
    expect(interleave([[], []])).toEqual([])
  })
})

describe('SearchView', () => {
  it('searches only on Enter, then lists both platforms side by side', async () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: '  lumen   fox ' } })
    expect(bridge.searchCommunity).not.toHaveBeenCalled()
    fireEvent.submit(box.closest('form')!)
    await waitFor(() => expect(bridge.searchCommunity).toHaveBeenCalledTimes(2))
    expect(bridge.searchCommunity).toHaveBeenCalledWith({ platform: 'vrchat', query: 'lumen fox' })
    expect(bridge.searchCommunity).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      query: 'lumen fox'
    })
    const people = await screen.findByRole('region', { name: msg('search.people') })
    const tiles = within(people).getAllByRole('button')
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      msg('search.openPersonAria', { name: 'Lumen', platform: 'VRChat' }),
      msg('search.openPersonAria', { name: 'Ember', platform: 'ChilloutVR' })
    ])
    expect(within(tiles[0]!).getByText(msg('search.friend'))).toBeTruthy()
    expect(screen.getByTestId('world-results').textContent).toBe(
      'vrchat:vrchat plazachilloutvr:chilloutvr plaza'
    )
  })

  it('renews an expired world card from the same search, not from Popular now', async () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'plaza' } })
    fireEvent.submit(box.closest('form')!)
    await screen.findByTestId('world-results')
    expect(bridge.searchCommunity).toHaveBeenCalledTimes(2)
    const renewed = await lastRecover.current!('chilloutvr')
    expect(bridge.searchCommunity).toHaveBeenCalledTimes(3)
    expect(bridge.searchCommunity).toHaveBeenLastCalledWith({
      platform: 'chilloutvr',
      query: 'plaza'
    })
    expect(renewed.map((item) => item.worldId)).toEqual(['chilloutvr-world-1'])
  })

  it('asks for two letters instead of searching for one', () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'a' } })
    fireEvent.submit(box.closest('form')!)
    expect(screen.getByRole('alert').textContent).toBe(msg('community.error.invalid-query'))
    expect(bridge.searchCommunity).not.toHaveBeenCalled()
  })

  it('opens a person in the profile sheet with the same fields on each platform', async () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'lumen' } })
    fireEvent.submit(box.closest('form')!)
    const tile = await screen.findByRole('button', {
      name: msg('search.openPersonAria', { name: 'Ember', platform: 'ChilloutVR' })
    })
    fireEvent.click(tile)
    const sheet = screen.getByRole('dialog', {
      name: msg('profile.aria', { name: 'Ember', platform: 'ChilloutVR' })
    })
    await within(sheet).findByText('Hello there')
    expect(within(sheet).getByText(msg('profile.pronouns'))).toBeTruthy()
    expect(within(sheet).getByText(msg('profile.notShown'))).toBeTruthy()
    expect(within(sheet).getByText('User')).toBeTruthy()
    expect(within(sheet).getByText('Supporter')).toBeTruthy()
    expect(bridge.getProfile).toHaveBeenCalledWith({ platform: 'chilloutvr', userId: CVR_ID })
    // Worlds are read only after the press.
    expect(bridge.getProfileWorlds).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole('button', { name: msg('profile.showWorlds') }))
    await within(sheet).findByText('Home Base')
    expect(bridge.getProfileWorlds).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tile).toBe(document.activeElement)
  })

  it('searches only the platform the filter picks, and sends nothing for a signed-out one', async () => {
    authState.chilloutvr = 'unauthenticated'
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'lumen' } })
    fireEvent.submit(box.closest('form')!)
    expect(await screen.findByText(msg('community.notConnected.chilloutvr'))).toBeTruthy()
    expect(bridge.searchCommunity).not.toHaveBeenCalled()
  })
})

describe('GroupsView', () => {
  it('lists both platforms in one name-sorted grid and opens a group', async () => {
    renderWith(<GroupsView />)
    const region = await screen.findByRole('region', { name: msg('groups.heading') })
    const tiles = within(region).getAllByRole('button')
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      msg('groups.openAria', { name: 'Aurora', platform: 'VRChat' }),
      msg('groups.openAria', { name: 'Meadow', platform: 'ChilloutVR' }),
      msg('groups.openAria', { name: 'Zephyr Club', platform: 'VRChat' })
    ])
    expect(within(tiles[0]!).getByText(msg('groups.role.owner'))).toBeTruthy()
    // No picture: a tidy first-letter tile instead of an empty box.
    const picture = tiles[0]!.querySelector('[data-community-tile-picture]')
    expect(picture?.getAttribute('data-community-tile-picture')).toBe('initial')
    expect(picture?.textContent).toBe('A')
    fireEvent.click(tiles[1]!)
    const sheet = screen.getByRole('dialog', {
      name: msg('groups.sheetAria', { name: 'Meadow', platform: 'ChilloutVR' })
    })
    expect(within(sheet).getByText('Meadow description')).toBeTruthy()
    expect(within(sheet).getByText('TAG')).toBeTruthy()
    expect(within(sheet).getByText('1,200')).toBeTruthy()
  })

  it('shows the first letter when a group picture fails to load', async () => {
    const broken = { ...group('vrchat', 'Broken', 'member'), imageUrl: 'https://x/broken.png' }
    const answer = (platform: Platform): Promise<MyGroupsResult> =>
      Promise.resolve({
        ok: true,
        platform,
        groups: platform === 'vrchat' ? [broken] : [],
        complete: true
      })
    bridge.getMyGroups
      .mockImplementationOnce(({ platform }: { platform: Platform }) => answer(platform))
      .mockImplementationOnce(({ platform }: { platform: Platform }) => answer(platform))
    avatarPicture.current = 'data:image/png;base64,AAAA'
    renderWith(<GroupsView />)
    const region = await screen.findByRole('region', { name: msg('groups.heading') })
    const tile = within(region).getByRole('button')
    const picture = (): Element | null => tile.querySelector('[data-community-tile-picture]')
    expect(picture()?.getAttribute('data-community-tile-picture')).toBe('image')
    expect(picture()?.textContent).toBe('')
    fireEvent.error(picture()!.querySelector('img:not([aria-hidden])')!)
    expect(picture()?.getAttribute('data-community-tile-picture')).toBe('initial')
    expect(picture()?.textContent).toBe('B')
  })

  it('asks main for a fresh list only on Refresh', async () => {
    renderWith(<GroupsView />)
    await screen.findByRole('region', { name: msg('groups.heading') })
    expect(bridge.getMyGroups).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: msg('groups.refresh') }))
    await waitFor(() =>
      expect(bridge.getMyGroups).toHaveBeenCalledWith({ platform: 'vrchat', refresh: true })
    )
    expect(bridge.getMyGroups).toHaveBeenCalledWith({ platform: 'chilloutvr', refresh: true })
  })
})

describe('ExploreListPanel', () => {
  it('alternates the two platforms’ newest worlds', async () => {
    renderWith(<ExploreListPanel list="new" />)
    const results = await screen.findByTestId('world-results')
    expect(results.textContent).toBe(
      'vrchat:vrchat onechilloutvr:chilloutvr onevrchat:vrchat twochilloutvr:chilloutvr two'
    )
    expect(bridge.getWorldList).toHaveBeenCalledWith({ platform: 'vrchat', list: 'new' })
  })

  it('renews an expired world card from the same list', async () => {
    renderWith(<ExploreListPanel list="updated" />)
    await screen.findByTestId('world-results')
    const renewed = await lastRecover.current!('vrchat')
    expect(bridge.getWorldList).toHaveBeenLastCalledWith({ platform: 'vrchat', list: 'updated' })
    expect(renewed).toHaveLength(2)
  })

  it('adds no line under ALL for a platform the user isn’t signed in to', async () => {
    authState.vrchat = 'unauthenticated'
    renderWith(<ExploreListPanel list="updated" />)
    await screen.findByTestId('world-results')
    expect(screen.queryByText(msg('community.notConnected.vrchat'))).toBeNull()
    expect(bridge.getWorldList).toHaveBeenCalledTimes(1)
  })
})

function Counts({
  platforms,
  enabled = true,
  page = 'dashboard'
}: {
  platforms: readonly Platform[]
  enabled?: boolean
  page?: string
}): React.JSX.Element {
  const counts = usePlayerCounts(platforms, enabled, page)
  return (
    <TopBarCounts
      status={<span>status</span>}
      dot={null}
      onlineCount={3}
      connectionLabel="connection"
      counts={counts}
    />
  )
}

function renderCounts(props: React.ComponentProps<typeof Counts>): (next: typeof props) => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <Counts {...props} />
    </QueryClientProvider>
  )
  return (next) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <Counts {...next} />
      </QueryClientProvider>
    )
}

describe('TopBarCounts', () => {
  it('names each platform beside its count', async () => {
    renderCounts({ platforms: ['vrchat', 'chilloutvr'] })
    const row = await screen.findByTestId('topbar-player-counts')
    expect(row.textContent).toContain('VRC54,321')
    expect(row.textContent).toContain('CVR1,234')
  })

  it('reads only the platforms the filter shows', async () => {
    renderCounts({ platforms: ['chilloutvr'] })
    await screen.findByTestId('topbar-player-counts')
    expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(1)
    expect(bridge.getPlayersOnline).toHaveBeenCalledWith({ platform: 'chilloutvr' })
  })

  it('reads nothing while the setting is off', async () => {
    renderCounts({ platforms: ['vrchat', 'chilloutvr'], enabled: false })
    await Promise.resolve()
    expect(bridge.getPlayersOnline).not.toHaveBeenCalled()
    expect(screen.queryByTestId('topbar-player-counts')).toBeNull()
  })

  it('opens the explaining panel on hover and closes it with Escape', async () => {
    renderCounts({ platforms: ['vrchat', 'chilloutvr'] })
    await screen.findByTestId('topbar-player-counts')
    const block = screen.getByTestId('topbar-counts')
    const panel = screen.getByRole('tooltip', { hidden: true })
    expect(block.getAttribute('aria-describedby')).toBe(panel.id)
    expect(panel.className).toContain('hidden')
    fireEvent.mouseEnter(block)
    expect(panel.className).not.toContain('hidden')
    expect(panel.textContent).toContain('VRChat')
    expect(panel.textContent).toContain('ChilloutVR')
    expect(panel.textContent).toContain(i18n.t('shell.counts.friendsOnline', { count: 3 }))
    fireEvent.keyDown(block, { key: 'Escape' })
    expect(panel.className).toContain('hidden')
  })

  it('re-reads on a page switch only once the answer is 5 minutes old', async () => {
    const now = vi.spyOn(Date, 'now')
    const start = 1_800_000_000_000
    now.mockReturnValue(start)
    const rerender = renderCounts({ platforms: ['vrchat'], page: 'dashboard' })
    await screen.findByTestId('topbar-player-counts')
    expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(1)

    now.mockReturnValue(start + 60_000)
    rerender({ platforms: ['vrchat'], page: 'friends' })
    await Promise.resolve()
    expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(1)

    now.mockReturnValue(start + 5 * 60_000)
    rerender({ platforms: ['vrchat'], page: 'hot' })
    await vi.waitFor(() => expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(2))
    now.mockRestore()
  })

  it('never re-reads a platform the filter hides or the setting turned off', async () => {
    const now = vi.spyOn(Date, 'now')
    const start = 1_800_000_000_000
    now.mockReturnValue(start)
    const rerender = renderCounts({ platforms: ['vrchat', 'chilloutvr'], page: 'dashboard' })
    const row = await screen.findByTestId('topbar-player-counts')
    await vi.waitFor(() => expect(row.textContent).toContain('CVR'))
    expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(2)

    now.mockReturnValue(start + 5 * 60_000)
    rerender({ platforms: ['vrchat'], page: 'friends' })
    await vi.waitFor(() => expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(3))
    expect(bridge.getPlayersOnline).toHaveBeenLastCalledWith({ platform: 'vrchat' })

    now.mockReturnValue(start + 11 * 60_000)
    rerender({ platforms: ['vrchat'], enabled: false, page: 'hot' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(bridge.getPlayersOnline).toHaveBeenCalledTimes(3)
    now.mockRestore()
  })
})

describe('ProfileDetails', () => {
  it('shows VRChat trust as its rank name', async () => {
    renderWith(<ProfileDetails platform="vrchat" userId={VRC_ID} />)
    expect(await screen.findByText(msg('drawer.trustRank.trusted'))).toBeTruthy()
    expect(screen.getByText('they/them')).toBeTruthy()
  })

  it('says when a profile is gone, without a retry', async () => {
    bridge.getProfile.mockResolvedValueOnce({ ok: false, reason: 'not-found' } as never)
    renderWith(<ProfileDetails platform="vrchat" userId={VRC_ID} />)
    expect(await screen.findByText(msg('profile.error.not-found'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('community.retry') })).toBeNull()
  })

  it('offers no friend action to a friend', async () => {
    renderWith(<ProfileDetails platform="vrchat" userId={VRC_ID} />)
    await screen.findByText('Hello there')
    expect(screen.queryByRole('button', { name: /friend/i })).toBeNull()
  })

  it.each(['vrchat', 'chilloutvr'] as const)(
    'sends one friend request from a %s profile and says it went out',
    async (platform) => {
      bridge.getProfile.mockResolvedValueOnce({
        ok: true,
        profile: { ...profile(platform), isFriend: false }
      })
      const userId = platform === 'vrchat' ? VRC_ID : CVR_ID
      const name = platform === 'vrchat' ? 'Lumen' : 'Ember'
      renderWith(<ProfileDetails platform={platform} userId={userId} />)
      const add = await screen.findByRole('button', {
        name: msg('friendActions.addAria', {
          name,
          platform: platform === 'vrchat' ? 'VRChat' : 'ChilloutVR'
        })
      })
      fireEvent.click(add)
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(msg('friendActions.sent'))
      )
      expect(bridge.sendFriendRequest).toHaveBeenCalledExactlyOnceWith({ platform, userId })
      expect(screen.queryByRole('button', { name: /friend request/i })).toBeNull()
    }
  )

  it('says why a friend request did not go out and lets the user press again', async () => {
    bridge.getProfile.mockResolvedValueOnce({
      ok: true,
      profile: { ...profile('vrchat'), isFriend: false }
    })
    bridge.sendFriendRequest.mockResolvedValueOnce({ ok: false, reason: 'rate-limited' } as never)
    renderWith(<ProfileDetails platform="vrchat" userId={VRC_ID} />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: msg('friendActions.addAria', { name: 'Lumen', platform: 'VRChat' })
      })
    )
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        msg('friendActions.error.rate-limited', { platform: 'VRChat' })
      )
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: msg('friendActions.addAria', { name: 'Lumen', platform: 'VRChat' })
      }).disabled
    ).toBe(false)
  })

  it('answers a waiting request instead of sending a new one', async () => {
    bridge.getProfile.mockResolvedValueOnce({
      ok: true,
      profile: { ...profile('chilloutvr'), isFriend: false }
    })
    const withInbox = Object.assign(bridge, {
      getInbox: vi.fn(() =>
        Promise.resolve({
          items: [
            {
              id: `friend-request:${CVR_ID}`,
              platform: 'chilloutvr',
              kind: 'friend-request',
              senderId: CVR_ID.toUpperCase(),
              senderName: 'Ember',
              worldName: null,
              receivedAt: 1
            }
          ]
        })
      )
    })
    try {
      renderWith(<ProfileDetails platform="chilloutvr" userId={CVR_ID} />)
      expect(await screen.findByText(msg('friendActions.incoming'))).toBeTruthy()
      expect(screen.queryByText(msg('friendActions.add'))).toBeNull()
      fireEvent.click(
        screen.getByRole('button', { name: msg('friendActions.acceptAria', { name: 'Ember' }) })
      )
      await waitFor(() =>
        expect(bridge.answerFriendRequest).toHaveBeenCalledWith({
          platform: 'chilloutvr',
          id: `friend-request:${CVR_ID}`,
          answer: 'accept'
        })
      )
      expect(bridge.sendFriendRequest).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(withInbox, 'getInbox')
    }
  })

  it('shows no friend action on the signed-in user’s own profile', async () => {
    bridge.getProfile.mockResolvedValueOnce({
      ok: true,
      profile: { ...profile('vrchat'), userId: 'vrchat-me', isFriend: false }
    })
    renderWith(<ProfileDetails platform="vrchat" userId="vrchat-me" />)
    await screen.findByText('Hello there')
    expect(screen.queryByText(msg('friendActions.add'))).toBeNull()
  })
})
