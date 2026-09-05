// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { fullFriend } from '../test-utils/friendFixture'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useProfileSelection } from '../stores/profileSelection'
import FriendsList from './FriendsList'
import i18n from '../i18n'

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
const world: InstanceInfo = {
  worldId: 'world',
  instanceId: 'world:1',
  worldName: 'First world',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  groupId: null,
  groupImageUrl: null,
  region: null,
  userCount: null
}
const inWorldVrc: Friend = { ...vrc, instance: world }
const inWorldCvr: Friend = {
  ...cvr,
  instance: {
    ...world,
    worldId: 'cvr-world',
    instanceId: 'cvr:2',
    worldName: 'Second world',
    type: 'friends',
    openness: 'friends'
  }
}
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
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] } })
  mocks.links.mockReturnValue({ data: { profiles: [profile], lease: 'lease' }, isError: false })
  roster([vrc, cvr])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'vrx')
})
describe('linked roster integration', () => {
  it('keeps a pending counterpart denial attributed after that account leaves the roster', async () => {
    roster([inWorldVrc, inWorldCvr])
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: false, collapsedFriendSections: [] }
    })
    let finish!: (result: { ok: false; reason: 'cooldown' }) => void
    const joinInstance = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    window.vrx = { joinInstance } as unknown as Window['vrx']
    const view = render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    fireEvent.click(within(list).getByRole('button', { name: '2 locations' }))
    fireEvent.click(screen.getByRole('button', { name: /Join on ChilloutVR/ }))
    expect(joinInstance).toHaveBeenCalledOnce()
    roster([inWorldVrc])
    view.rerender(<FriendsList />)
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await act(async () => {
      finish({ ok: false, reason: 'cooldown' })
    })
    expect(within(list).getByRole('status').textContent).toContain(
      i18n.t('friends.joinFailure.cooldown')
    )
    fireEvent.click(within(list).getByRole('button', { name: /^Combined/ }))
    expect(
      within(screen.getByRole('dialog', { name: 'Combined' })).getByRole('status').textContent
    ).toContain(i18n.t('friends.joinFailure.cooldown'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    act(() => {
      useFriendsStore.setState({ platformFilter: 'vrchat' })
    })
    view.rerender(<FriendsList />)
    expect(within(list).getByRole('status').textContent).toBe('')
  })

  it('labels the one eligible counterpart rather than the hidden header account', () => {
    roster([{ ...inWorldVrc, status: 'ask-me' }, inWorldCvr])
    render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    const pill = within(list).getByRole('button', { name: /Join Combined/ })
    expect(pill.textContent).toContain('Friends')
    expect(pill.textContent).not.toContain('Private')
  })
  it.each([false, true])(
    'shows a failed counterpart join after the chooser closes (two locations: %s)',
    async (both) => {
      roster([both ? inWorldVrc : { ...inWorldVrc, status: 'ask-me' }, inWorldCvr])
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, confirmJoin: false, collapsedFriendSections: [] }
      })
      const joinInstance = vi.fn().mockResolvedValue({ ok: false, reason: 'cooldown' })
      window.vrx = { joinInstance } as unknown as Window['vrx']
      render(<FriendsList />)
      const list = screen.getByRole('list', { name: 'Friends' })
      fireEvent.click(
        within(list).getByRole('button', { name: both ? '2 locations' : /Join Combined/ })
      )
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Join on ChilloutVR/ }))
      })
      expect(joinInstance).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'chilloutvr', friendId: cvr.platformUserId })
      )
      expect(screen.queryByRole('button', { name: /Join on ChilloutVR/ })).toBeNull()
      expect(within(list).getByRole('status').textContent).toContain(
        i18n.t('friends.joinFailure.cooldown')
      )
      fireEvent.click(within(list).getByRole('button', { name: /^Combined/ }))
      expect(
        within(screen.getByRole('dialog', { name: 'Combined' })).getByRole('status').textContent
      ).toContain(i18n.t('friends.joinFailure.cooldown'))
      Reflect.deleteProperty(window, 'vrx')
    }
  )

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
  it('shows attributed worlds and opens the same two-destination chooser from row and drawer', () => {
    roster([inWorldVrc, inWorldCvr])
    render(<FriendsList />)
    const list = screen.getByRole('list', { name: 'Friends' })
    expect(within(list).getByText('First world')).toBeTruthy()
    expect(within(list).getByText('Second world')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '2 locations' }))
    expect(screen.getAllByRole('button', { name: /Join on/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(list).getByRole('button', { name: /^Combined/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Combined' })).getByRole('button', { name: 'Join' })
    )
    expect(screen.getAllByRole('button', { name: /Join on/ })).toHaveLength(2)
  })
  it('retains a hovered combined shape until leave while removing unsafe destinations immediately', () => {
    roster([inWorldVrc, inWorldCvr])
    const view = render(<FriendsList />)
    const row = document.querySelector('[data-friend-key="person:pair"]')!
    fireEvent.pointerEnter(row)
    roster([{ ...inWorldVrc, presence: { state: 'active' } }, inWorldCvr])
    view.rerender(<FriendsList />)
    expect(document.querySelectorAll('[data-virtual-kind="friend"]')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '2 locations' })).toBeNull()
    expect(within(row as HTMLElement).queryByText('First world')).toBeNull()
    fireEvent.pointerLeave(row)
    expect(document.querySelectorAll('[data-virtual-kind="friend"]')).toHaveLength(2)
  })
  it('releases a focused split transition at five seconds and restores the same person focus', () => {
    vi.useFakeTimers()
    roster([inWorldVrc, inWorldCvr])
    const view = render(<FriendsList />)
    const opener = screen.getByRole('button', { name: /^Combined/ })
    act(() => opener.focus())
    roster([{ ...inWorldVrc, presence: { state: 'active' } }, inWorldCvr])
    view.rerender(<FriendsList />)
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(document.querySelectorAll('[data-virtual-kind="friend"]')).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(document.querySelectorAll('[data-virtual-kind="friend"]')).toHaveLength(2)
    expect(
      document.activeElement?.closest('[data-friend-key]')?.getAttribute('data-friend-key')
    ).toContain('person:pair:')
  })
  it('keeps a removed held row inert and falls back to search at the deadline', () => {
    vi.useFakeTimers()
    roster([inWorldVrc, inWorldCvr])
    const view = render(<FriendsList />)
    act(() => screen.getByRole('button', { name: /^Combined/ }).focus())
    roster([])
    view.rerender(<FriendsList />)
    expect(screen.queryByRole('button', { name: '2 locations' })).toBeNull()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search friends' }))
  })
  it('cannot retarget a pointer gesture to a new row after a live split', () => {
    roster([inWorldVrc, inWorldCvr])
    const view = render(<FriendsList />)
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Combined/ }))
    roster([{ ...inWorldVrc, presence: { state: 'active' } }, inWorldCvr])
    view.rerender(<FriendsList />)
    fireEvent.click(screen.getByRole('button', { name: /^CVR alias/ }))
    expect(useProfileSelection.getState().target).toBeNull()
  })
  it('cancels an outgoing account gesture synchronously and focuses search on a boundary', () => {
    const listeners = new Set<(event: { platform: 'vrchat' }) => void>()
    window.vrx = {
      onIdentityBoundary: (listener: (event: { platform: 'vrchat' }) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    } as unknown as Window['vrx']
    render(<FriendsList />)
    const opener = screen.getByRole('button', { name: /^Combined/ })
    fireEvent.click(opener)
    fireEvent.pointerDown(opener)
    act(() => {
      for (const listener of listeners) listener({ platform: 'vrchat' })
    })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search friends' }))
    fireEvent.click(opener)
    expect(useProfileSelection.getState().target).toBeNull()
    fireEvent.pointerDown(opener)
    fireEvent.click(opener)
    expect(useProfileSelection.getState().target?.kind).toBe('person')
    Reflect.deleteProperty(window, 'vrx')
  })
  it('releases a held combined row immediately when unlink changes person identity', () => {
    const view = render(<FriendsList />)
    fireEvent.pointerEnter(document.querySelector('[data-friend-key]')!)
    mocks.links.mockReturnValue({ data: { profiles: [], lease: 'lease' }, isError: false })
    view.rerender(<FriendsList />)
    expect(document.querySelectorAll('[data-virtual-kind="friend"]')).toHaveLength(2)
    expect(document.querySelector('[data-friend-key="person:pair"]')).toBeNull()
  })
  it('applies a deliberate platform filter immediately despite a hovered combined row', () => {
    render(<FriendsList />)
    fireEvent.pointerEnter(document.querySelector('[data-friend-key]')!)
    act(() => useFriendsStore.setState({ platformFilter: 'chilloutvr' }))
    const list = screen.getByRole('list', { name: 'Friends' })
    expect(within(list).queryByText('Combined')).toBeNull()
    expect(within(list).getByText('CVR alias')).toBeTruthy()
  })
})
