// @vitest-environment jsdom
/**
 * Search, Groups, Explore's New and Recently updated lists, the Dashboard's
 * "Playing now" line and the full profile (owner, 2026-10-31). VRChat and
 * ChilloutVR get the same tiles, notices and sheets; nothing is read before
 * the user asks, and a signed-out platform adds no request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { useUiStore } from '../stores/ui'
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

/** A promise with its resolver exposed, for a platform that answers late. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function search(text: string): void {
  const box = screen.getByRole('searchbox', { name: msg('search.aria') })
  fireEvent.change(box, { target: { value: text } })
  fireEvent.submit(box.closest('form')!)
}

const loadingLine = (platform: 'VRChat' | 'ChilloutVR'): string =>
  msg('community.loading', { platform })

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

  it('asks again when Search is pressed after a “One moment” answer', async () => {
    bridge.searchCommunity
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'neko' } })
    fireEvent.submit(box.closest('form')!)
    expect(await screen.findAllByText(msg('community.error.cooldown'))).toHaveLength(2)
    expect(bridge.searchCommunity).toHaveBeenCalledTimes(2)

    fireEvent.submit(box.closest('form')!)
    await waitFor(() => expect(bridge.searchCommunity).toHaveBeenCalledTimes(4))
    expect(await screen.findByTestId('world-results')).toBeTruthy()
    expect(screen.queryByText(msg('community.error.cooldown'))).toBeNull()
  })

  it('asks again for text whose last answer was a refusal, and only then', async () => {
    bridge.searchCommunity
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    const search = async (text: string, calls: number): Promise<void> => {
      fireEvent.change(box, { target: { value: text } })
      fireEvent.submit(box.closest('form')!)
      await waitFor(() => expect(bridge.searchCommunity).toHaveBeenCalledTimes(calls))
    }
    await search('neko', 2)
    await screen.findAllByText(msg('community.error.cooldown'))
    await search('nekomimi', 4)
    await screen.findByTestId('world-results')
    // Back to the refused text: a new answer, not the kept refusal.
    await search('Neko', 6)
    expect(bridge.searchCommunity).toHaveBeenLastCalledWith({
      platform: 'chilloutvr',
      query: 'Neko'
    })
    // A good answer is reused as before: pressing Search again sends nothing.
    fireEvent.submit(box.closest('form')!)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(bridge.searchCommunity).toHaveBeenCalledTimes(6)
  })

  it('asks for two letters instead of searching for one', () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: 'a' } })
    fireEvent.submit(box.closest('form')!)
    expect(screen.getByRole('alert').textContent).toBe(msg('community.error.invalid-query'))
    expect(bridge.searchCommunity).not.toHaveBeenCalled()
  })

  it('searches one kanji, which is often a whole word', async () => {
    renderWith(<SearchView />)
    const box = screen.getByRole('searchbox', { name: msg('search.aria') })
    fireEvent.change(box, { target: { value: ' 猫 ' } })
    fireEvent.submit(box.closest('form')!)
    await waitFor(() => expect(bridge.searchCommunity).toHaveBeenCalledTimes(2))
    expect(bridge.searchCommunity).toHaveBeenCalledWith({ platform: 'vrchat', query: '猫' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names no platform in its hint, so a filtered page never promises one it skips', () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderWith(<SearchView />)
    const hint = screen.getByRole('searchbox', { name: msg('search.aria') })
    const described = document.getElementById(hint.getAttribute('aria-describedby')!)!
    expect(described.textContent).toBe(msg('search.hint'))
    expect(described.textContent).not.toContain('ChilloutVR')
    expect(described.textContent).not.toContain('VRChat')
  })

  it('says in Japanese that no people were found, apart from the worlds found', async () => {
    const worldsOnly = (platform: Platform): CommunitySearchResult => ({
      ok: true,
      platform,
      query: 'neko',
      people: [],
      worlds: [world(platform, 1, `${platform} plaza`)]
    })
    bridge.searchCommunity
      .mockResolvedValueOnce(worldsOnly('vrchat'))
      .mockResolvedValueOnce(worldsOnly('chilloutvr'))
    await i18n.changeLanguage('ja')
    try {
      renderWith(<SearchView />)
      const box = screen.getByRole('searchbox', { name: msg('search.aria') })
      fireEvent.change(box, { target: { value: 'neko' } })
      fireEvent.submit(box.closest('form')!)
      const people = await screen.findByRole('region', { name: '人' })
      expect(within(people).getByText('人は見つかりませんでした。')).toBeTruthy()
      expect(screen.getByTestId('world-results')).toBeTruthy()
    } finally {
      await i18n.changeLanguage('en')
    }
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

  it('opens another person, or the same one again, at the top of the sheet', async () => {
    renderWith(<SearchView />)
    search('lumen')
    const lumen = await screen.findByRole('button', {
      name: msg('search.openPersonAria', { name: 'Lumen', platform: 'VRChat' })
    })
    const ember = screen.getByRole('button', {
      name: msg('search.openPersonAria', { name: 'Ember', platform: 'ChilloutVR' })
    })
    const scroller = (): HTMLElement =>
      screen.getByRole('dialog').querySelector<HTMLElement>('.overflow-y-auto')!
    fireEvent.click(lumen)
    scroller().scrollTop = 240
    fireEvent.click(ember)
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
      msg('profile.aria', { name: 'Ember', platform: 'ChilloutVR' })
    )
    expect(scroller().scrollTop).toBe(0)
    scroller().scrollTop = 120
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(ember)
    expect(scroller().scrollTop).toBe(0)
  })

  it('shows a person’s first letter instead of an empty box when there is no picture', async () => {
    renderWith(<SearchView />)
    search('lumen')
    const tile = await screen.findByRole('button', {
      name: msg('search.openPersonAria', { name: 'Ember', platform: 'ChilloutVR' })
    })
    const picture = tile.querySelector('[data-community-tile-picture]')
    expect(picture?.getAttribute('data-community-tile-picture')).toBe('initial')
    expect(picture?.textContent).toBe('E')
  })

  it('shows the first letter when a person’s picture fails to load', async () => {
    avatarPicture.current = 'data:image/png;base64,AAAA'
    renderWith(<SearchView />)
    search('lumen')
    const tile = await screen.findByRole('button', {
      name: msg('search.openPersonAria', { name: 'Lumen', platform: 'VRChat' })
    })
    const picture = (): Element | null => tile.querySelector('[data-community-tile-picture]')
    expect(picture()?.getAttribute('data-community-tile-picture')).toBe('image')
    expect(picture()?.textContent).toBe('')
    fireEvent.error(picture()!.querySelector('img')!)
    expect(picture()?.getAttribute('data-community-tile-picture')).toBe('initial')
    expect(picture()?.textContent).toBe('L')
  })

  it('says nothing was found only once every shown platform has answered', async () => {
    const vrchat = deferred<CommunitySearchResult>()
    const answer = ({
      platform,
      query
    }: {
      platform: Platform
      query: string
    }): Promise<CommunitySearchResult> =>
      platform === 'vrchat'
        ? vrchat.promise
        : Promise.resolve({
            ok: true,
            platform,
            query,
            people: [],
            worlds: [world(platform, 1, 'chilloutvr plaza')]
          })
    bridge.searchCommunity.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<SearchView />)
    search('plaza')
    await screen.findByTestId('world-results')
    expect(screen.getByText(loadingLine('VRChat'))).toBeTruthy()
    // ChilloutVR found no one, but VRChat hasn't answered yet.
    expect(screen.queryByText(msg('search.noPeople'))).toBeNull()
    expect(screen.queryByRole('region', { name: msg('search.people') })).toBeNull()
    vrchat.resolve({ ok: true, platform: 'vrchat', query: 'plaza', people: [], worlds: [] })
    expect(await screen.findByText(msg('search.noPeople'))).toBeTruthy()
    expect(screen.queryByText(loadingLine('VRChat'))).toBeNull()
  })

  it('says no one was found only when no shown platform failed', async () => {
    const answer = ({
      platform,
      query
    }: {
      platform: Platform
      query: string
    }): Promise<CommunitySearchResult> =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: false, reason: 'unavailable' }
          : {
              ok: true,
              platform,
              query,
              people: [],
              worlds: [world(platform, 1, 'chilloutvr plaza')]
            }
      )
    bridge.searchCommunity.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<SearchView />)
    search('plaza')
    await screen.findByTestId('world-results')
    expect(
      await screen.findByText(msg('community.error.unavailable', { platform: 'VRChat' }))
    ).toBeTruthy()
    // VRChat couldn't answer, so "No people found." would not be true for it.
    expect(screen.queryByText(msg('search.noPeople'))).toBeNull()
    expect(screen.queryByRole('region', { name: msg('search.people') })).toBeNull()
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
    // Worded like every other way to Accounts.
    expect(msg('community.openAccounts')).toBe(msg('avatars.notConnected.openAccounts'))
    fireEvent.click(screen.getByRole('button', { name: msg('community.openAccounts') }))
    expect(useUiStore.getState().activeTab).toBe('settings')
    expect(useUiStore.getState().settingsCategory).toBe('accounts')
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
    // An owned group says so in front of its code, like every other tile's code.
    expect(within(tiles[0]!).getByText(new RegExp(`^${msg('groups.role.owner')} · `))).toBeTruthy()
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

  it('keeps keyboard focus on Refresh while it runs and ignores more presses', async () => {
    renderWith(<GroupsView />)
    await screen.findByRole('region', { name: msg('groups.heading') })
    const loaded = bridge.getMyGroups.getMockImplementation()!
    const waiting: Array<() => void> = []
    bridge.getMyGroups.mockImplementation(
      (request) =>
        new Promise<MyGroupsResult>((resolve) =>
          waiting.push(() => void loaded(request).then(resolve))
        )
    )
    const button = screen.getByRole<HTMLButtonElement>('button', { name: msg('groups.refresh') })
    button.focus()
    fireEvent.click(button)
    const busy = await screen.findByRole<HTMLButtonElement>('button', {
      name: msg('groups.refreshing')
    })
    // Off while it runs, yet still focusable, so keyboard focus stays on it.
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(busy.disabled).toBe(false)
    expect(document.activeElement).toBe(busy)
    fireEvent.click(busy)
    fireEvent.click(busy)
    expect(bridge.getMyGroups).toHaveBeenCalledTimes(4)

    await act(async () => waiting.forEach((answer) => answer()))
    const idle = await screen.findByRole('button', { name: msg('groups.refresh') })
    expect(idle.getAttribute('aria-disabled')).toBeNull()
    expect(bridge.getMyGroups).toHaveBeenCalledTimes(4)
    bridge.getMyGroups.mockImplementation(loaded)
  })

  it('keeps the loaded groups when a Refresh fails, and says so in a dim line', async () => {
    renderWith(<GroupsView />)
    const region = await screen.findByRole('region', { name: msg('groups.heading') })
    expect(within(region).getAllByRole('button')).toHaveLength(3)
    // VRChat's Refresh fails; ChilloutVR's answers as before.
    const failVrchat = ({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
      platform === 'vrchat'
        ? Promise.resolve({ ok: false, reason: 'unavailable' })
        : Promise.resolve({
            ok: true,
            platform,
            groups: [group('chilloutvr', 'Meadow', 'member')],
            complete: true
          })
    bridge.getMyGroups.mockImplementationOnce(failVrchat).mockImplementationOnce(failVrchat)
    fireEvent.click(screen.getByRole('button', { name: msg('groups.refresh') }))
    const line = await screen.findByText(msg('community.stale', { platform: 'VRChat' }))
    expect(line.className).toContain('text-[var(--text-dim)]')
    expect(
      within(screen.getByRole('region', { name: msg('groups.heading') })).getAllByRole('button')
    ).toHaveLength(3)
    expect(
      screen.queryByText(msg('community.error.unavailable', { platform: 'VRChat' }))
    ).toBeNull()
  })

  it('says the platform asked to slow down when a Refresh of loaded groups gets a 429', async () => {
    renderWith(<GroupsView />)
    await screen.findByRole('region', { name: msg('groups.heading') })
    const slowVrchat = ({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
      platform === 'vrchat'
        ? Promise.resolve({ ok: false, reason: 'rate-limited' })
        : Promise.resolve({
            ok: true,
            platform,
            groups: [group('chilloutvr', 'Meadow', 'member')],
            complete: true
          })
    bridge.getMyGroups.mockImplementationOnce(slowVrchat).mockImplementationOnce(slowVrchat)
    fireEvent.click(screen.getByRole('button', { name: msg('groups.refresh') }))
    const line = await screen.findByText(msg('community.staleRateLimited', { platform: 'VRChat' }))
    expect(line.className).toContain('text-[var(--text-dim)]')
    expect(screen.queryByText(msg('community.stale', { platform: 'VRChat' }))).toBeNull()
  })

  it('still shows a red line when the first read fails', async () => {
    bridge.getMyGroups.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderWith(<GroupsView />)
    const line = await screen.findByText(msg('community.error.unavailable', { platform: 'VRChat' }))
    expect(line.className).toContain('text-[var(--error)]')
    expect(screen.queryByRole('region', { name: msg('groups.heading') })).toBeNull()
  })

  it('says you have no groups only once every shown platform has answered', async () => {
    const vrchat = deferred<MyGroupsResult>()
    const answer = ({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
      platform === 'vrchat'
        ? vrchat.promise
        : Promise.resolve({ ok: true, platform, groups: [], complete: true })
    bridge.getMyGroups.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<GroupsView />)
    expect(screen.getByText(loadingLine('ChilloutVR'))).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(loadingLine('ChilloutVR'))).toBeNull())
    // ChilloutVR has no groups, but VRChat hasn't answered yet.
    expect(screen.getByText(loadingLine('VRChat'))).toBeTruthy()
    expect(screen.queryByText(msg('groups.empty'))).toBeNull()
    expect(screen.queryByRole('region', { name: msg('groups.heading') })).toBeNull()
    vrchat.resolve({ ok: true, platform: 'vrchat', groups: [], complete: true })
    expect(await screen.findByText(msg('groups.empty'))).toBeTruthy()
  })

  it('says you have no groups only when no shown platform failed', async () => {
    const answer = ({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: false, reason: 'unavailable' }
          : { ok: true, platform, groups: [], complete: true }
      )
    bridge.getMyGroups.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<GroupsView />)
    expect(
      await screen.findByText(msg('community.error.unavailable', { platform: 'VRChat' }))
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(loadingLine('ChilloutVR'))).toBeNull())
    // VRChat couldn't answer, so "no groups" would not be true for it.
    expect(screen.queryByText(msg('groups.empty'))).toBeNull()
    expect(screen.queryByRole('region', { name: msg('groups.heading') })).toBeNull()
  })

  it('offers Accounts, not Try again, when a platform asks to sign in again', async () => {
    const answer = ({ platform }: { platform: Platform }): Promise<MyGroupsResult> =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: false, reason: 'not-authenticated' }
          : { ok: true, platform, groups: [], complete: true }
      )
    bridge.getMyGroups.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<GroupsView />)
    const notice = await screen.findByText(
      msg('community.error.not-authenticated', { platform: 'VRChat' })
    )
    const line = within(notice.closest<HTMLElement>('[data-community-notice]')!)
    expect(line.queryByRole('button', { name: msg('community.retry') })).toBeNull()
    fireEvent.click(line.getByRole('button', { name: msg('community.openAccounts') }))
    expect(useUiStore.getState().activeTab).toBe('settings')
    expect(useUiStore.getState().settingsCategory).toBe('accounts')
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

  it('keeps the loaded worlds when a later read fails', async () => {
    renderWith(<ExploreListPanel list="new" />)
    const shown = (await screen.findByTestId('world-results')).textContent
    bridge.getWorldList.mockResolvedValueOnce({ ok: false, reason: 'rate-limited' })
    await act(async () => {
      await lastRecover.current!('vrchat')
    })
    // A 429 also says to wait a minute.
    expect(
      await screen.findByText(msg('community.staleRateLimited', { platform: 'VRChat' }))
    ).toBeTruthy()
    expect(screen.getByTestId('world-results').textContent).toBe(shown)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says it is loading while Try again asks again, then shows the new answer', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    bridge.getWorldList.mockResolvedValueOnce({ ok: false, reason: 'rate-limited' })
    renderWith(<ExploreListPanel list="new" />)
    const failed = msg('community.error.rate-limited', { platform: 'VRChat' })
    expect(await screen.findByText(failed)).toBeTruthy()
    let answer: (result: WorldListResult) => void = () => {}
    bridge.getWorldList.mockImplementationOnce(
      () => new Promise<WorldListResult>((resolve) => (answer = resolve))
    )
    const retry = screen.getByRole('button', { name: msg('community.retry') })
    retry.focus()
    fireEvent.click(retry)
    expect(await screen.findByText(msg('community.loading', { platform: 'VRChat' }))).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
    expect(screen.queryByRole('button', { name: msg('community.retry') })).toBeNull()
    // Keyboard focus stays on the platform's line, not the top of the window.
    const line = document.querySelector('[data-community-notice="vrchat"]')
    expect(document.activeElement).toBe(line)
    // A second refusal shows again, so it never looks like an ignored press.
    act(() => answer({ ok: false, reason: 'rate-limited' }))
    expect(await screen.findByText(failed)).toBeTruthy()
    expect(document.activeElement).toBe(line)
    expect(bridge.getWorldList).toHaveBeenCalledTimes(2)
  })

  it('says there are no worlds only once every shown platform has answered', async () => {
    const vrchat = deferred<WorldListResult>()
    const answer = ({
      platform,
      list
    }: {
      platform: Platform
      list: 'new' | 'updated'
    }): Promise<WorldListResult> =>
      platform === 'vrchat'
        ? vrchat.promise
        : Promise.resolve({ ok: true, platform, list, worlds: [] })
    bridge.getWorldList.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<ExploreListPanel list="new" />)
    expect(screen.getByText(loadingLine('ChilloutVR'))).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(loadingLine('ChilloutVR'))).toBeNull())
    expect(screen.getByText(loadingLine('VRChat'))).toBeTruthy()
    expect(screen.queryByText(msg('explore.lists.empty'))).toBeNull()
    vrchat.resolve({ ok: true, platform: 'vrchat', list: 'new', worlds: [] })
    expect(await screen.findByText(msg('explore.lists.empty'))).toBeTruthy()
  })

  it('says there are no worlds only when no shown platform failed', async () => {
    const answer = ({
      platform,
      list
    }: {
      platform: Platform
      list: 'new' | 'updated'
    }): Promise<WorldListResult> =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: false, reason: 'unavailable' }
          : { ok: true, platform, list, worlds: [] }
      )
    bridge.getWorldList.mockImplementationOnce(answer).mockImplementationOnce(answer)
    renderWith(<ExploreListPanel list="new" />)
    expect(
      await screen.findByText(msg('community.error.unavailable', { platform: 'VRChat' }))
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(loadingLine('ChilloutVR'))).toBeNull())
    expect(screen.queryByText(msg('explore.lists.empty'))).toBeNull()
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

  it('leaves the trust rank out where the friend card already shows it', async () => {
    renderWith(<ProfileDetails platform="vrchat" userId={VRC_ID} showTrust={false} />)
    expect(await screen.findByText('they/them')).toBeTruthy()
    expect(screen.queryByText(msg('drawer.trustRank.trusted'))).toBeNull()
    expect(screen.queryByText(msg('profile.rank'))).toBeNull()
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
    // Unfriend or block (the profile's last section) is not a friend action.
    expect(screen.queryByRole('button', { name: /friend request/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(accept|decline)\b/i })).toBeNull()
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
