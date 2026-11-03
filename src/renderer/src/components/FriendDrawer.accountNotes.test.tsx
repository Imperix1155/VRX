// @vitest-environment jsdom
/**
 * Friend notes on the user's own account: the quiet line under the note, the
 * save after an edit, and the choice when both copies changed.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountNoteSyncResult } from '@shared/accountNotes'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useProfileSelection } from '../stores/profileSelection'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { resetAccountNotesForTests } from '../hooks/useAccountNote'
import FriendsList from './FriendsList'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-test`,
      displayName: 'Test User'
    }
  })
}))

const friend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance: {
    worldId: 'wrld_fixture',
    instanceId: 'wrld_fixture:12345~public',
    worldName: 'The Great Pug',
    thumbnailUrl: null,
    type: 'public',
    openness: 'public',
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: 'us',
    userCount: 14
  },
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

const revision = { platformAccountId: 'self', epoch: 1 }
const slow = { timeout: 3000 }

let getFriendNote: ReturnType<typeof vi.fn>
let setFriendNote: ReturnType<typeof vi.fn>
let syncFriendNote: ReturnType<typeof vi.fn<(req: unknown) => Promise<AccountNoteSyncResult>>>

function open(): HTMLElement {
  fireEvent.click(
    screen.getByRole('button', { name: (name) => name === 'Alex' || name.startsWith('Alex ') })
  )
  return screen.getByRole('dialog')
}

beforeEach(() => {
  resetAccountNotesForTests()
  getFriendNote = vi.fn().mockResolvedValue({ note: 'Plays drums', revision })
  setFriendNote = vi.fn().mockResolvedValue({ ok: true })
  syncFriendNote = vi.fn(async () => ({ ok: true, state: 'saved', note: 'Plays drums' }) as const)
  window.vrx = {
    getFriendNote,
    setFriendNote,
    syncFriendNote,
    getAvatar: vi.fn().mockResolvedValue(null)
  } as unknown as Window['vrx']
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, dirty: false })
  useFriendsMock.mockImplementation((platform: string) => ({
    data: [friend].filter((f) => f.platform === platform),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
})

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
})

describe('FriendDrawer account notes', () => {
  it('checks the account once the drawer stays open and says the note is saved there', async () => {
    render(<FriendsList />)
    const scoped = within(open())
    await waitFor(() => expect(scoped.getByDisplayValue('Plays drums')).toBeTruthy())
    expect(syncFriendNote).not.toHaveBeenCalled()

    await waitFor(
      () => expect(scoped.getByText('Also saved to your VRChat account')).toBeTruthy(),
      slow
    )
    expect(syncFriendNote).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      revision,
      mode: 'check'
    })
  })

  it('saves to the account after an edit is saved in VRX', async () => {
    render(<FriendsList />)
    const scoped = within(open())
    const textarea = await waitFor(() => scoped.getByDisplayValue('Plays drums'))
    fireEvent.change(textarea, { target: { value: 'Plays bass' } })
    fireEvent.blur(textarea)

    await waitFor(() =>
      expect(syncFriendNote).toHaveBeenCalledWith(expect.objectContaining({ mode: 'save' }))
    )
    expect(setFriendNote).toHaveBeenCalledTimes(1)
  })

  it('still saves to the account when closing the drawer flushes the edit', async () => {
    render(<FriendsList />)
    const scoped = within(open())
    const textarea = await waitFor(() => scoped.getByDisplayValue('Plays drums'))
    fireEvent.change(textarea, { target: { value: 'Plays bass' } })
    fireEvent.click(scoped.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(syncFriendNote).toHaveBeenCalledWith({
        platform: 'vrchat',
        friendId: 'usr_alex',
        revision,
        mode: 'save'
      })
    )
  })

  it('offers a save for a note that is only on this PC', async () => {
    syncFriendNote.mockResolvedValueOnce({ ok: true, state: 'local-only', note: 'Plays drums' })
    render(<FriendsList />)
    const scoped = within(open())
    const save = await scoped.findByRole('button', { name: 'Save to VRChat' }, slow)
    expect(scoped.getByText('Only on this PC so far.')).toBeTruthy()
    fireEvent.click(save)
    await waitFor(() =>
      expect(syncFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'save' }))
    )
  })

  it('says a longer account note stays on the account, and offers nothing to take', async () => {
    syncFriendNote.mockResolvedValueOnce({
      ok: true,
      state: 'account-too-long',
      note: 'Plays drums'
    })
    render(<FriendsList />)
    const scoped = within(open())
    await waitFor(
      () =>
        expect(
          scoped.getByText(
            'Your VRChat account has a longer note for this friend than VRX keeps (500 characters), so it stays there.'
          )
        ).toBeTruthy(),
      slow
    )
    expect(scoped.getByDisplayValue('Plays drums')).toBeTruthy()
    expect(syncFriendNote).toHaveBeenCalledTimes(1)
  })

  it('takes a newer account copy on its own when VRX copy did not change', async () => {
    syncFriendNote
      .mockResolvedValueOnce({
        ok: true,
        state: 'account-changed',
        note: 'Plays drums',
        accountNote: 'Plays drums in a band'
      })
      .mockResolvedValueOnce({ ok: true, state: 'saved', note: 'Plays drums in a band' })
    render(<FriendsList />)
    const scoped = within(open())
    await waitFor(
      () => expect(scoped.getByDisplayValue('Plays drums in a band')).toBeTruthy(),
      slow
    )
    expect(syncFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'use-account' })
    )
    // Taking the account copy is not an edit, so nothing is sent back.
    expect(syncFriendNote).toHaveBeenCalledTimes(2)
  })

  it('asks which note to keep when both changed', async () => {
    syncFriendNote
      .mockResolvedValueOnce({
        ok: true,
        state: 'conflict',
        note: 'Plays drums',
        accountNote: 'Written in the game'
      })
      .mockResolvedValueOnce({ ok: true, state: 'saved', note: 'Plays drums' })
    render(<FriendsList />)
    const scoped = within(open())
    const keep = await scoped.findByRole('button', { name: 'Keep mine' }, slow)
    expect(
      scoped.getByText('Your VRChat account has a different note for this friend:')
    ).toBeTruthy()
    expect(scoped.getByText('Written in the game')).toBeTruthy()
    expect(scoped.getByRole('button', { name: 'Use the VRChat note' })).toBeTruthy()

    fireEvent.click(keep)
    await waitFor(() =>
      expect(syncFriendNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: 'keep-mine' })
      )
    )
    await waitFor(() => expect(scoped.queryByRole('button', { name: 'Keep mine' })).toBeNull())
  })

  it('says a note over 500 characters must be shortened before it can be saved', async () => {
    const long = 'x'.repeat(600)
    getFriendNote.mockResolvedValue({ note: long, revision })
    syncFriendNote.mockResolvedValue({ ok: true, state: 'saved', note: long })
    render(<FriendsList />)
    const scoped = within(open())
    const textarea = await waitFor(() => scoped.getByDisplayValue(long), slow)
    const line = scoped.getByText(
      'This note is over 500 characters. Shorten it to save your changes.'
    )
    expect(textarea.getAttribute('aria-describedby')).toContain(line.id)

    fireEvent.change(textarea, { target: { value: long.slice(1) } })
    fireEvent.blur(textarea)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(setFriendNote).not.toHaveBeenCalled()
  })

  it('offers only Keep mine when the account note is longer than VRX keeps', async () => {
    syncFriendNote.mockResolvedValueOnce({
      ok: true,
      state: 'conflict',
      note: 'Plays drums',
      accountNote: 'x'.repeat(501)
    })
    render(<FriendsList />)
    const scoped = within(open())
    await scoped.findByRole('button', { name: 'Keep mine' }, slow)
    expect(scoped.queryByRole('button', { name: 'Use the VRChat note' })).toBeNull()
    expect(
      scoped.getByText("VRX can't take this one: it keeps notes up to 500 characters.")
    ).toBeTruthy()
  })

  it('shows a retry when the account cannot be reached', async () => {
    syncFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    render(<FriendsList />)
    const scoped = within(open())
    const retry = await scoped.findByRole('button', { name: 'Retry' }, slow)
    expect(scoped.getByText("Couldn't reach VRChat. Saved on this PC.")).toBeTruthy()
    fireEvent.click(retry)
    await waitFor(() => expect(syncFriendNote).toHaveBeenCalledTimes(2))
  })

  // Each button gives way to the line's next state when pressed; keyboard
  // focus moves to where that state shows, not into the note, where a held
  // Enter would type.
  it.each<[string, AccountNoteSyncResult, string, string]>([
    [
      'Save to VRChat',
      { ok: true, state: 'local-only', note: 'Plays drums' },
      'save',
      'Plays drums'
    ],
    ['Retry', { ok: false, reason: 'unavailable' }, 'check', 'Plays drums'],
    [
      'Keep mine',
      { ok: true, state: 'conflict', note: 'Plays drums', accountNote: 'In game' },
      'keep-mine',
      'Plays drums'
    ],
    [
      'Use the VRChat note',
      { ok: true, state: 'conflict', note: 'Plays drums', accountNote: 'In game' },
      'use-account',
      'In game'
    ]
  ])('moves keyboard focus to the account line after %s', async (label, first, mode, kept) => {
    syncFriendNote
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ok: true, state: 'saved', note: kept })
    render(<FriendsList />)
    const scoped = within(open())
    const button = await scoped.findByRole('button', { name: label }, slow)
    const line = document.getElementById('friend-notes-counter')?.parentElement
    button.focus()
    fireEvent.click(button)

    expect(scoped.queryByRole('button', { name: label })).toBeNull()
    expect(document.activeElement).toBe(line)
    await waitFor(() => expect(syncFriendNote).toHaveBeenCalledTimes(2))
    expect(syncFriendNote.mock.calls[1][0]).toMatchObject({ mode })
    await waitFor(() => expect(scoped.getByText('Also saved to your VRChat account')).toBeTruthy())
    expect(scoped.getByDisplayValue(kept)).toBeTruthy()
    expect(document.activeElement).toBe(line)
  })

  it('never asks the account when the setting is off', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, saveNotesToAccounts: false },
      dirty: false
    })
    render(<FriendsList />)
    const scoped = within(open())
    const textarea = await waitFor(() => scoped.getByDisplayValue('Plays drums'))
    fireEvent.change(textarea, { target: { value: 'Plays bass' } })
    fireEvent.blur(textarea)
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(syncFriendNote).not.toHaveBeenCalled()
  })
})
