// @vitest-environment jsdom
/**
 * FriendDrawer (VRX-69 phase 1) — integration-tested through FriendsList:
 * row click/Enter opens the dialog with THAT friend's data; Esc/scrim/✕ close
 * and restore focus; focus is trapped; the status band renders the privacy
 * tier in words + the right token (CVR online folds to Online); Join renders
 * only for joinable friends; Ask Me/DND show "Hidden".
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
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

const publicInstance: InstanceInfo = {
  worldId: 'wrld_fixture',
  instanceId: 'wrld_fixture:12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  region: 'us',
  userCount: 14
}

const joinableFriend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: 'come thru',
  instance: publicInstance,
  trustRank: 'known',
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

const cvrFriend: Friend = {
  platformUserId: 'cvr_mika',
  platform: 'chilloutvr',
  displayName: 'Mika',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: null,
  statusDescription: null,
  instance: { ...publicInstance, type: 'friends-of-friends' },
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

function mockFriends(friends: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) => ({
    data: friends.filter((f) => f.platform === platform),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
}

/** Transient roster gap — refetch after cache clear / account switch. */
function mockRosterUndefined(): void {
  useFriendsMock.mockImplementation(() => ({
    data: undefined,
    isPending: true,
    isError: false,
    isFetching: true,
    refetch: vi.fn()
  }))
}

/** The row's details opener — its accessible name COMPOSES from the visible
 *  name + status + world (aria-labelledby), so match on the leading name. */
function rowOpener(name: string): HTMLElement {
  return screen.getByRole('button', {
    name: (accName) => accName === name || accName.startsWith(`${name} `)
  })
}

function openDrawerFor(name: string): HTMLElement {
  const row = rowOpener(name)
  fireEvent.click(row)
  return row
}

const dialog = (): HTMLElement => screen.getByRole('dialog')

let joinInstance: ReturnType<typeof vi.fn>

let getFriendNote: ReturnType<typeof vi.fn>
let setFriendNote: ReturnType<typeof vi.fn>

beforeEach(() => {
  joinInstance = vi.fn().mockResolvedValue({ ok: true })
  getFriendNote = vi
    .fn()
    .mockResolvedValue({ note: null, revision: { platformAccountId: 'self', epoch: 1 } })
  setFriendNote = vi.fn().mockResolvedValue({ ok: true })
  window.vrx = { joinInstance, getFriendNote, setFriendNote } as unknown as Window['vrx']
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  mockFriends([joinableFriend])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useFriendsMock.mockReset()
})

describe('FriendDrawer (VRX-69)', () => {
  it('opens on row click with that friend’s data', () => {
    render(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()

    openDrawerFor('Alex')

    const panel = screen.getByRole('dialog', { name: 'Alex' })
    const scoped = within(panel)
    expect(scoped.getByText('come thru')).toBeTruthy() // custom status
    expect(scoped.getByText('VRChat')).toBeTruthy() // full-word platform pill
    expect(scoped.getByText('Online')).toBeTruthy() // status word
    expect(scoped.getByText('Around and reachable')).toBeTruthy() // descriptor
    expect(scoped.getByText('The Great Pug')).toBeTruthy() // WHERE world
    expect(scoped.getByText('Public')).toBeTruthy() // shared InstancePill
    expect(scoped.getByText('Trust: Known User')).toBeTruthy()
  })

  it('renders the frosted glass variant on the panel (VRX-226)', () => {
    render(<FriendsList />)
    openDrawerFor('Alex')
    const panel = screen.getByRole('dialog', { name: 'Alex' })
    // Base .glass for the material; .glass-frosted for the opaque underlay +
    // stronger blur — the drawer floats OVER the live list, so row text must
    // not read through it (base .glass is only correct on the background).
    // Token-exact check: `/\bglass\b/` also matches inside "glass-frosted"
    // (the hyphen is a word boundary), so split the class list instead
    // (Codex review, VRX-226).
    const classes = panel.className.split(/\s+/)
    expect(classes).toContain('glass')
    expect(classes).toContain('glass-frosted')
  })

  it('the opener is a native button distinct from Join, with a composed accessible name', () => {
    render(<FriendsList />)
    const opener = rowOpener('Alex')
    const joinButton = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })

    // Two DISTINCT focusable controls — the Join pill is never nested inside
    // an interactive role (VRX-69 review restructure).
    expect(opener).not.toBe(joinButton)
    expect(opener.tagName).toBe('BUTTON') // native Enter/Space activation
    expect(joinButton.tagName).toBe('BUTTON')
    opener.focus()
    expect(document.activeElement).toBe(opener)
    joinButton.focus()
    expect(document.activeElement).toBe(joinButton)

    // The composed accessible NAME keeps the §9.1 non-color signals —
    // name + STATUS + world + PLATFORM — nothing is hidden by an overriding
    // aria-label (platform added in the Kimi re-review round, VRX-206).
    expect(screen.getByRole('button', { name: 'Alex Online The Great Pug VRChat' })).toBe(opener)

    // The li itself is purely structural again (listitem semantics intact).
    expect(opener.closest('li')?.getAttribute('role')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('Esc closes and returns focus to the opening row', () => {
    render(<FriendsList />)
    const row = openDrawerFor('Alex')
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('outside pointerdown closes; ✕ closes; focus returns to the row both ways (VRX-225)', () => {
    render(<FriendsList />)
    let row = openDrawerFor('Alex')
    // Outside = anywhere that is neither the panel nor a [data-drawer-opener].
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)

    row = openDrawerFor('Alex')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('is NON-MODAL (VRX-225): no aria-modal, no focus trap, non-blocking scrim', () => {
    render(<FriendsList />)
    openDrawerFor('Alex')

    const dlg = dialog()
    // A modal claim over an interactive background would lie to assistive tech.
    expect(dlg.getAttribute('aria-modal')).toBeNull()

    // Initial focus still lands inside (keyboard users arrive in the card)…
    const closeButton = within(dlg).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(closeButton)

    // …but Tab is NOT trapped: the old trap listened on document and wrapped
    // last→first; now a Tab keydown from the last focusable must leave focus
    // management to the browser (no preventDefault, no forced wrap).
    const notesTextarea = within(dlg).getByRole('textbox', { name: 'Notes (yours, private)' })
    notesTextarea.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(notesTextarea) // unmoved by any trap handler

    // The scrim never intercepts input — the list behind stays interactive.
    expect(screen.getByTestId('friend-drawer-scrim').className).toContain('pointer-events-none')
  })

  it('outside close never loses a dirty note — the forced blur saves first (VRX-225, Codex sequence)', async () => {
    render(<FriendsList />)
    openDrawerFor('Alex')
    const textarea = within(dialog()).getByRole('textbox', { name: 'Notes (yours, private)' })
    await waitFor(() => expect(getFriendNote).toHaveBeenCalled())

    fireEvent.change(textarea, { target: { value: 'met at the pug' } })
    textarea.focus()

    // The risky real sequence: dirty textarea → outside pointerdown → close →
    // focus-return forces the textarea blur → the blur-save must still fire.
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.blur(textarea)
    await waitFor(() =>
      expect(setFriendNote).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'met at the pug', friendId: 'usr_alex' })
      )
    )
  })

  it('with the card open, joining ANOTHER row closes the card and still joins (VRX-225, Codex sequence)', async () => {
    mockFriends([joinableFriend, { ...cvrFriend, instance: publicInstance }])
    render(<FriendsList />)
    openDrawerFor('Alex')

    // Real pointer order on the other row's Join pill: pointerdown (not an
    // opener, not the panel → closes the card) THEN click (joins).
    const joinMika = screen.getByRole('button', { name: 'Join Mika in The Great Pug' })
    fireEvent.pointerDown(joinMika)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      fireEvent.click(joinMika)
      await Promise.resolve()
    })
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      friendId: 'cvr_mika',
      mode: 'desktop'
    })
  })

  it('while closed, the drawer wrapper is inert and hidden (no ghost card, VRX-225)', () => {
    render(<FriendsList />)
    const row = openDrawerFor('Alex')
    const wrapper = dialog().parentElement as HTMLElement
    expect(wrapper.getAttribute('aria-hidden')).toBe('false')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(row)
  })

  it('pointerdown on another avatar SWITCHES the card instead of closing (VRX-225)', () => {
    mockFriends([joinableFriend, cvrFriend])
    render(<FriendsList />)
    openDrawerFor('Alex')
    expect(dialog().getAttribute('aria-label')).toBe('Alex')

    // The outside-close listener must exempt [data-drawer-opener] targets so
    // the subsequent click switches in place (close-then-reopen would flicker).
    const otherAvatar = rowOpener('Mika')
    fireEvent.pointerDown(otherAvatar)
    expect(screen.queryByRole('dialog')).toBeTruthy() // still open after pointerdown
    fireEvent.click(otherAvatar)
    expect(dialog().getAttribute('aria-label')).toBe('Mika')
  })

  it.each([
    ['join-me', 'Join Me', '--st-joinme', 'Open to joins — hop in freely'],
    ['online', 'Online', '--st-online', 'Around and reachable'],
    ['ask-me', 'Ask Me', '--st-askme', 'Ask before joining'],
    ['dnd', 'Do Not Disturb', '--st-dnd', 'Not accepting joins']
  ] as const)('status band renders %s in words + its token', (status, word, token, desc) => {
    mockFriends([{ ...joinableFriend, status }])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const wordEl = within(dialog()).getByText(word)
    expect(wordEl.getAttribute('style') ?? '').toContain(`var(${token}-text)`)
    expect(within(dialog()).getByText(desc)).toBeTruthy()
  })

  it('folds CVR online onto the tier-2 Online band (never the state palette)', () => {
    mockFriends([cvrFriend])
    render(<FriendsList />)
    openDrawerFor('Mika')

    const scoped = within(dialog())
    const wordEl = scoped.getByText('Online')
    expect(wordEl.getAttribute('style') ?? '').toContain('var(--st-online-text)')
    expect(scoped.getByText('ChilloutVR')).toBeTruthy()
    // CVR FoF instance resolves through the shared tier map (VRChat-scheme label).
    expect(scoped.getByText('Friends+')).toBeTruthy()
    // No fabricated CVR extras: no custom status, no trust line.
    expect(scoped.queryByText(/Trust:/)).toBeNull()
  })

  it('renders the Offline band for an offline friend, with no Join', () => {
    // The Offline section is collapsed by default — expand it to reach the row.
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] },
      dirty: false
    })
    mockFriends([
      { ...joinableFriend, status: null, presence: { state: 'offline' }, instance: null }
    ])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    expect(scoped.getByText('Offline')).toBeTruthy()
    expect(scoped.getByText('Not connected')).toBeTruthy()
    expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it.each([['ask-me'], ['dnd']] as const)(
    '%s shows "Hidden" as the world and no Join',
    (status) => {
      mockFriends([{ ...joinableFriend, status }])
      render(<FriendsList />)
      openDrawerFor('Alex')

      const scoped = within(dialog())
      expect(scoped.getByText('Hidden')).toBeTruthy()
      expect(scoped.queryByText('The Great Pug')).toBeNull()
      expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
    }
  )

  it('shows Join ONLY for joinable friends and reuses the row’s join flow', async () => {
    render(<FriendsList />)
    openDrawerFor('Alex')

    const joinButton = within(dialog()).getByRole('button', { name: 'Join' })
    await act(async () => {
      fireEvent.click(joinButton)
      await Promise.resolve()
    })
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
  })

  it('web-active friend gets no Join button and no WHERE world line', () => {
    mockFriends([
      { ...joinableFriend, presence: { state: 'active' }, instance: null, trustRank: null }
    ])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
    expect(scoped.queryByText('The Great Pug')).toBeNull()
    expect(scoped.queryByText('Where')).toBeNull()
  })

  it('announces a denied join via the drawer’s status blip', async () => {
    vi.useFakeTimers()
    joinInstance.mockResolvedValue({ ok: false, reason: 'not-joinable' })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    await act(async () => {
      fireEvent.click(scoped.getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })
    expect(scoped.getByRole('status').textContent).toBe("Couldn't join")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(scoped.getByRole('status').textContent).toBe('')
  })

  it.each([
    ['stale', 'Live connection not ready — joins resume when the live feed reconnects'],
    ['cooldown', 'One moment — just launched a join']
  ] as const)('announces distinct %s denial copy in the drawer', async (reason, copy) => {
    joinInstance.mockResolvedValue({ ok: false, reason })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    await act(async () => {
      fireEvent.click(scoped.getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(scoped.getByRole('status').textContent).toBe(copy)
  })

  it('the "/" search shortcut works while the non-modal drawer is open — but never from inside the notes textarea (VRX-225)', () => {
    render(<FriendsList />)
    openDrawerFor('Alex')
    const closeButton = within(dialog()).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(closeButton)

    // Non-modal: the list's shortcuts stay live with the card open. The old
    // suppression served the retired focus trap (Codex review, VRX-225).
    fireEvent.keyDown(document, { key: '/' })
    expect((document.activeElement as HTMLElement).tagName).toBe('INPUT') // search focused

    // …but typing `/` INSIDE an editable control must never steal focus.
    const textarea = within(dialog()).getByRole('textbox', { name: 'Notes (yours, private)' })
    textarea.focus()
    fireEvent.keyDown(textarea, { key: '/' }) // bubbles to the document handler with target=textarea
    expect(document.activeElement).toBe(textarea)

    // After closing, "/" works again.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: '/' })
    expect((document.activeElement as HTMLInputElement).placeholder).toBe('Search friends')
  })

  it('clears a stale selection when the friend leaves the roster (no surprise reopen)', () => {
    const { rerender } = render(<FriendsList />)
    openDrawerFor('Alex')
    expect(screen.getByRole('dialog')).toBeTruthy()

    mockFriends([]) // friend removed from the settled roster
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The opener row unmounted with the roster — the unified close path must
    // fall back to the search input, never drop focus to <body>.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search friends' }))

    mockFriends([joinableFriend]) // friend returns — the drawer must NOT reopen
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useFriendsStore.getState().selectedFriendId).toBeNull()
  })

  it('a transient roster gap (undefined) closes through the one close path — no reopen', () => {
    const { rerender } = render(<FriendsList />)
    openDrawerFor('Alex')
    expect(screen.getByRole('dialog')).toBeTruthy()

    mockRosterUndefined() // refetch gap / account switch: friends === undefined
    rerender(<FriendsList />)
    // The FIFTH close path (Codex re-review): the selection is cleared, the
    // dialog is gone, and focus lands on the fallback — not stranded on the
    // now-inert hidden ✕ button.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useFriendsStore.getState().selectedFriendId).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search friends' }))

    mockFriends([joinableFriend]) // data returns — the drawer must NOT reopen
    rerender(<FriendsList />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offline with a retained Ask Me status shows Offline — never "Hidden"', () => {
    // isWorldHidden requires in-game presence (Codex re-review): an offline
    // friend with a cached ask-me/dnd status has no world to hide.
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapsedFriendSections: [] },
      dirty: false
    })
    mockFriends([
      { ...joinableFriend, status: 'ask-me', presence: { state: 'offline' }, instance: null }
    ])
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    expect(scoped.getByText('Offline')).toBeTruthy()
    expect(scoped.getByText('Not connected')).toBeTruthy()
    expect(scoped.queryByText('Hidden')).toBeNull()
    expect(scoped.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('clicking the join pill inside the row does NOT open the drawer', async () => {
    render(<FriendsList />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('loads and shows the private-notes section for the selected friend', async () => {
    getFriendNote.mockResolvedValue({
      note: 'My private note',
      revision: { platformAccountId: 'self', epoch: 1 }
    })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    await waitFor(() => expect(scoped.getByDisplayValue('My private note')).toBeTruthy())
    expect(getFriendNote).toHaveBeenCalledWith({ platform: 'vrchat', friendId: 'usr_alex' })
    expect(scoped.getByText('Notes (yours, private)')).toBeTruthy()
  })

  it('saves the note on blur only when it changed', async () => {
    getFriendNote.mockResolvedValue({
      note: 'Original',
      revision: { platformAccountId: 'self', epoch: 1 }
    })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    const textarea = await waitFor(() => scoped.getByDisplayValue('Original'))

    fireEvent.change(textarea, { target: { value: 'Updated' } })
    fireEvent.blur(textarea)
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    expect(setFriendNote).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      note: 'Updated',
      revision: { platformAccountId: 'self', epoch: 1 }
    })

    fireEvent.blur(textarea)
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
  })

  it('shows a live N/500 counter and caps input at 500 chars', async () => {
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    const textarea = await waitFor(() =>
      scoped.getByRole('textbox', { name: 'Notes (yours, private)' })
    )

    fireEvent.change(textarea, { target: { value: 'abc' } })
    expect(scoped.getByText('3/500')).toBeTruthy()

    fireEvent.change(textarea, { target: { value: 'a'.repeat(501) } })
    expect((textarea as HTMLTextAreaElement).value).toHaveLength(500)
    expect(scoped.getByText('500/500')).toBeTruthy()
  })

  it('closes the drawer with Escape while focus is in the textarea', async () => {
    render(<FriendsList />)
    const row = openDrawerFor('Alex')

    const scoped = within(dialog())
    const textarea = await waitFor(() =>
      scoped.getByRole('textbox', { name: 'Notes (yours, private)' })
    )
    ;(textarea as HTMLTextAreaElement).focus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('renders empty without crashing when the preload bridge is absent', async () => {
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    render(<FriendsList />)
    openDrawerFor('Alex')

    const scoped = within(dialog())
    const textarea = await waitFor(() =>
      scoped.getByRole('textbox', { name: 'Notes (yours, private)' })
    )
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })
})

describe('VRX-228 whole-card drawer opener (default) + avatar-only setting', () => {
  /** The row's <li> for a friend (found via its avatar opener button). */
  function rowLi(name: string): HTMLElement {
    const li = rowOpener(name).closest('li')
    if (li === null) throw new Error(`no row for ${name}`)
    return li
  }

  it("card mode (default): clicking the row body opens that friend's drawer; the li stays a plain listitem", () => {
    render(<FriendsList />)
    const li = rowLi('Alex')
    // The card surface carries the outside-close exemption; the li itself
    // gains NO interactive role and NO tab stop (the VRX-69 role-flattening
    // finding — the avatar button remains the only semantic/keyboard opener).
    expect(li.hasAttribute('data-drawer-opener')).toBe(true)
    expect(li.getAttribute('role')).toBeNull()
    expect(li.tabIndex).toBe(-1)

    // Click the world subline — not the avatar, not the pill.
    fireEvent.click(within(li).getByText('The Great Pug'))
    const panel = screen.getByRole('dialog', { name: 'Alex' })
    expect(within(panel).getByText('come thru')).toBeTruthy()
  })

  it("card mode: clicking ANOTHER row's body SWITCHES the open drawer in place (no close between)", () => {
    mockFriends([joinableFriend, cvrFriend])
    render(<FriendsList />)
    fireEvent.click(rowLi('Alex'))
    expect(dialog().getAttribute('aria-label')).toBe('Alex')

    // The row's exemption keeps the outside-close listener quiet on
    // pointerdown (no close event between — the owner-praised behavior),
    // then the click switches the card in place.
    fireEvent.pointerDown(rowLi('Mika'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(rowLi('Mika'))
    expect(dialog().getAttribute('aria-label')).toBe('Mika')
    // …and Mika's data actually renders (not a stale panel).
    expect(within(dialog()).getByText('ChilloutVR')).toBeTruthy()
  })

  it('card mode: a text-selection drag inside the row does NOT open the drawer', () => {
    render(<FriendsList />)
    const li = rowLi('Alex')
    const nameEl = within(li).getByText('Alex')
    const selection = window.getSelection()
    expect(selection).not.toBeNull()
    const range = document.createRange()
    range.selectNodeContents(nameEl)
    selection!.removeAllRanges()
    selection!.addRange(range)
    expect(selection!.isCollapsed).toBe(false)

    // The mouseup-after-drag still dispatches a click on the row — the
    // non-collapsed-selection guard must swallow it.
    fireEvent.click(li)
    expect(screen.queryByRole('dialog')).toBeNull()

    // A plain click afterwards (selection collapsed) opens normally.
    selection!.removeAllRanges()
    fireEvent.click(li)
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
  })

  it('card mode: a NON-collapsed selection OUTSIDE the row does NOT block opening', () => {
    render(<FriendsList />)
    // A stale selection left over somewhere else on the page (e.g. drawer
    // note text selected earlier) must not turn the row click into a dead
    // click — the drag guard only applies to selections intersecting the row.
    const outside = document.createElement('div')
    outside.textContent = 'stale selection elsewhere'
    document.body.appendChild(outside)
    const selection = window.getSelection()
    expect(selection).not.toBeNull()
    const range = document.createRange()
    range.selectNodeContents(outside)
    selection!.removeAllRanges()
    selection!.addRange(range)
    expect(selection!.isCollapsed).toBe(false)

    fireEvent.click(rowLi('Alex'))
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
  })

  it('card mode: the Join pill joins and does NOT open — and with the card open elsewhere it keeps the VRX-225 close-then-join sequence', async () => {
    mockFriends([joinableFriend, { ...cvrFriend, instance: publicInstance }])
    render(<FriendsList />)
    fireEvent.click(rowLi('Alex'))
    expect(dialog().getAttribute('aria-label')).toBe('Alex')

    const joinMika = screen.getByRole('button', { name: 'Join Mika in The Great Pug' })
    // The pill is NEVER part of the opener surface — even inside a card-mode
    // row: the card closes on the pointerdown (the VRX-225 sequence)…
    fireEvent.pointerDown(joinMika)
    expect(screen.queryByRole('dialog')).toBeNull()
    // …then the click joins — it never opens or switches the drawer.
    await act(async () => {
      fireEvent.click(joinMika)
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      friendId: 'cvr_mika',
      mode: 'desktop'
    })
  })

  it('avatar mode pins the VRX-225 behavior: the row body is inert, only the avatar opens', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, drawerOpener: 'avatar' },
      dirty: false
    })
    render(<FriendsList />)
    const li = rowLi('Alex')
    // Byte-preserved VRX-225 surface: no row exemption, no row click target.
    expect(li.hasAttribute('data-drawer-opener')).toBe(false)
    fireEvent.click(li)
    expect(screen.queryByRole('dialog')).toBeNull()

    // The avatar button is still the opener (pointer AND keyboard).
    openDrawerFor('Alex')
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
  })

  it('the setting flips surfaces live: an open drawer survives a mid-open mode change', () => {
    mockFriends([joinableFriend, cvrFriend])
    render(<FriendsList />)
    fireEvent.click(rowLi('Alex'))
    expect(dialog().getAttribute('aria-label')).toBe('Alex')

    act(() => useSettingsStore.getState().updateSettings({ drawerOpener: 'avatar' }))
    // No remount weirdness: the drawer stays open on the same friend…
    expect(dialog().getAttribute('aria-label')).toBe('Alex')
    // …and future clicks follow the NEW mode (row body inert, avatar opens).
    fireEvent.click(rowLi('Mika'))
    expect(dialog().getAttribute('aria-label')).toBe('Alex')
    openDrawerFor('Mika')
    expect(dialog().getAttribute('aria-label')).toBe('Mika')
  })
})
