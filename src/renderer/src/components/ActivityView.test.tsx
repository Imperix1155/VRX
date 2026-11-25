// @vitest-environment jsdom
/**
 * Activity page (owner, 2026-10-27): friends coming online, joining worlds and
 * going offline, newest first, with the same row on both platforms.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ActivityEntry, ActivityPage, ActivityPageRequest } from '@shared/activity'
import { ACTIVITY_MAX_ENTRIES_PER_PLATFORM, SEARCH_DEBOUNCE_MS } from '@shared/constants'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { translate as msg } from '../i18n/translate'
import { activityKey, subscribeActivity } from '../queries/activity'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import { useProfileSelection } from '../stores/profileSelection'
import { fullFriend } from '../test-utils/friendFixture'
import { activityDateBounds } from '../utils/activityRange'
import ActivityView from './ActivityView'

const useFriendsMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ value: 'authenticated', pending: false }))
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') =>
    authState.pending
      ? { data: undefined, isSuccess: false, isFetching: true, isPending: true }
      : {
          data: { platform, state: authState.value, accountId: null, displayName: null },
          isSuccess: true,
          isFetching: false,
          isPending: false
        }
}))

// jsdom has no ResizeObserver; the segmented control's bubble hook needs one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const alice = fullFriend('Alice', 'vrchat')
const kai = fullFriend('Kai', 'chilloutvr')
const now = Date.now()

const entries: ActivityEntry[] = [
  {
    id: 4,
    kind: 'offline',
    platform: 'chilloutvr',
    platformUserId: kai.platformUserId,
    displayName: 'Kai',
    worldName: null,
    at: now - 1_000
  },
  {
    id: 3,
    kind: 'world',
    platform: 'vrchat',
    platformUserId: alice.platformUserId,
    displayName: 'Alice',
    worldName: 'Night Market',
    at: now - 2_000
  },
  {
    id: 2,
    kind: 'online',
    platform: 'chilloutvr',
    platformUserId: kai.platformUserId,
    displayName: 'Kai',
    worldName: 'Sunset Bay (#42)',
    at: now - 3_000
  },
  {
    id: 1,
    kind: 'online',
    platform: 'vrchat',
    platformUserId: 'usr_gone',
    displayName: 'Former Friend',
    worldName: null,
    at: now - 4_000
  }
]

let client: QueryClient
const clearActivity = vi.fn(() => Promise.resolve())
const getActivityPage = vi.fn((request: ActivityPageRequest): Promise<ActivityPage> =>
  Promise.resolve({ entries: [], hasMore: request.scope.length < 0 })
)
/** Nothing saved: the list lasts until VRX closes, and Clear acts at once. */
const SESSION_ONLY = { ...DEFAULT_SETTINGS, activityKeepFor: 'session' as const }

function renderView(data: ActivityEntry[] = entries): void {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(activityKey, data)
  render(
    <QueryClientProvider client={client}>
      <ActivityView />
    </QueryClientProvider>
  )
}

function rowTexts(): string[] {
  return screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? [alice] : [kai],
    isPending: false
  }))
  Object.defineProperty(window, 'vrx', {
    configurable: true,
    value: { getActivity: () => Promise.resolve(entries), clearActivity, getActivityPage }
  })
})

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  clearActivity.mockClear()
  getActivityPage.mockReset()
  getActivityPage.mockImplementation(() => Promise.resolve({ entries: [], hasMore: false }))
  authState.value = 'authenticated'
  authState.pending = false
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    acknowledgedSettings: DEFAULT_SETTINGS,
    dirty: false,
    saveError: false
  })
  useUiStore.setState({ activeTab: 'activity' })
  useProfileSelection.setState({ target: null })
  Reflect.deleteProperty(window, 'vrx')
})

describe('ActivityView', () => {
  it('lists both platforms newest first, in words, with each platform named', () => {
    renderView()
    const rows = rowTexts()
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain('Kai')
    expect(rows[0]).toContain(msg('activity.offline'))
    expect(rows[0]).toContain(msg('dashboard.platformCvr'))
    expect(rows[1]).toContain(msg('activity.joined', { world: 'Night Market' }))
    expect(rows[1]).toContain(msg('dashboard.platformVrc'))
    // ChilloutVR's "(#…)" instance tag is trimmed from the world name.
    expect(rows[2]).toContain(msg('activity.onlineIn', { world: 'Sunset Bay' }))
    expect(rows[3]).toContain(msg('activity.online'))
  })

  it('keeps the full world name on hover, a "(#…)" tag included (owner rule VRX-199)', () => {
    renderView()
    const line = screen.getByText(msg('activity.onlineIn', { world: 'Sunset Bay' }))
    expect(line.getAttribute('title')).toBe('Sunset Bay (#42)')
  })

  it("names each row's platform when it is read out, in the language's own punctuation", async () => {
    const aliceCvr = fullFriend('Alice', 'chilloutvr')
    useFriendsMock.mockImplementation((platform: string) => ({
      data: platform === 'vrchat' ? [alice] : [kai, aliceCvr],
      isPending: false
    }))
    const both: ActivityEntry[] = (['chilloutvr', 'vrchat'] as const).map((platform, index) => ({
      // Newest first, as main sends them.
      id: 11 - index,
      kind: 'online',
      platform,
      platformUserId: platform === 'vrchat' ? alice.platformUserId : aliceCvr.platformUserId,
      displayName: 'Alice',
      worldName: null,
      at: now - 1_000 * (index + 1)
    }))
    renderView(both)
    const [cvrRow, vrcRow] = screen.getAllByRole('button', { name: /^Alice, / })
    // One person's two rows no longer sound the same: each says its platform.
    expect(cvrRow!.getAttribute('aria-label')).toContain(msg('dashboard.platformCvr'))
    expect(vrcRow!.getAttribute('aria-label')).toContain(msg('dashboard.platformVrc'))
    expect(cvrRow!.getAttribute('aria-label')).not.toBe(vrcRow!.getAttribute('aria-label'))
    cleanup()

    await i18n.changeLanguage('ja')
    try {
      renderView(both)
      const label = screen
        .getAllByRole('button', { name: /^Alice、/ })[0]!
        .getAttribute('aria-label')
      // Japanese joins the parts with its own marks, not ", " and ". ".
      expect(label).not.toMatch(/, |\. /)
      expect(label).toContain('ChilloutVR')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('tints each entry with its own platform, the same recipe on both', () => {
    renderView()
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.className)).toEqual([
      'platform-row platform-row--chilloutvr',
      'platform-row platform-row--vrchat',
      'platform-row platform-row--chilloutvr',
      'platform-row platform-row--vrchat'
    ])
    // Both pills fill the same fixed column, so they are the same size.
    for (const item of items) {
      expect(item.querySelector('[data-platform-pill]')?.classList).toContain('w-full')
    }
  })

  it('filters by kind through the saved Show setting', () => {
    renderView()
    const show = screen.getByRole('radiogroup', { name: msg('activity.filterAria') })
    fireEvent.click(within(show).getByRole('radio', { name: msg('activity.kinds.online') }))
    expect(useSettingsStore.getState().settings.activityFilter).toBe('online')
    expect(rowTexts()).toHaveLength(2)

    fireEvent.click(within(show).getByRole('radio', { name: msg('activity.kinds.world') }))
    expect(rowTexts()).toEqual([expect.stringContaining('Night Market')])
  })

  it('follows the platform filter', () => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderView()
    const rows = rowTexts()
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toContain(msg('dashboard.platformCvr'))
  })

  it('opens a friend on the Friends page, and leaves a removed friend as plain text', () => {
    renderView()
    const items = screen.getAllByRole('listitem')
    expect(within(items[3]!).queryByRole('button')).toBeNull()

    fireEvent.click(within(items[1]!).getByRole('button'))
    expect(useUiStore.getState().activeTab).toBe('friends')
    expect(useProfileSelection.getState().target).toEqual({
      kind: 'account',
      account: { platform: 'vrchat', friendId: alice.platformUserId },
      personId: null
    })
  })

  it('shows a short empty state, and a different line when only the filter hides rows', () => {
    renderView([])
    expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy()
    // The hint wraps into even lines, never leaving one word alone.
    expect(screen.getByText(msg('activity.emptyHint')).className).toContain('text-balance')
    expect(
      screen
        .getByRole<HTMLButtonElement>('button', { name: msg('activity.clearAria') })
        .getAttribute('aria-disabled')
    ).toBe('true')
    cleanup()

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, activityFilter: 'world' } })
    renderView(entries.filter((entry) => entry.kind !== 'world'))
    expect(screen.getByText(msg('activity.filteredEmpty'))).toBeTruthy()
    // Nothing on screen, so there is nothing for Clear to take away.
    expect(
      screen
        .getByRole<HTMLButtonElement>('button', { name: msg('activity.clearAria') })
        .getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('says it is loading, never "No activity yet", until the list was read after the sign-in check', async () => {
    // Launch: the page read an empty list before main knew whose activity to
    // bring back. Saved rows exist; main hands them over once it knows.
    authState.pending = true
    const getActivity = vi.fn(() => Promise.resolve(entries))
    Object.defineProperty(window, 'vrx', {
      configurable: true,
      value: { getActivity, clearActivity, getActivityPage }
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(activityKey, [])
    const tree = (): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <ActivityView />
      </QueryClientProvider>
    )
    const view = render(tree())
    expect(screen.getByText(msg('activity.loading'))).toBeTruthy()
    expect(screen.queryByText(msg('activity.emptyHeading'))).toBeNull()
    expect(getActivity).not.toHaveBeenCalled()

    // The sign-in check answers: the list is read again, and the rows show.
    authState.pending = false
    view.rerender(tree())
    expect(screen.queryByText(msg('activity.emptyHeading'))).toBeNull()
    await waitFor(() => expect(rowTexts()).toHaveLength(4))
    expect(getActivity).toHaveBeenCalledTimes(1)
  })

  it('shows "No activity yet" once the list read after the sign-in check is empty', async () => {
    authState.pending = true
    Object.defineProperty(window, 'vrx', {
      configurable: true,
      value: { getActivity: () => Promise.resolve([]), clearActivity, getActivityPage }
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(activityKey, [])
    const tree = (): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <ActivityView />
      </QueryClientProvider>
    )
    const view = render(tree())
    expect(screen.queryByText(msg('activity.emptyHeading'))).toBeNull()
    authState.pending = false
    view.rerender(tree())
    expect(await screen.findByText(msg('activity.emptyHeading'))).toBeTruthy()
  })

  it('clears through main and empties the list at once', async () => {
    useSettingsStore.setState({ settings: SESSION_ONLY })
    renderView()
    const clear = screen.getByRole<HTMLButtonElement>('button', {
      name: msg('activity.clearAria')
    })
    clear.focus()
    fireEvent.click(clear)
    expect(clearActivity).toHaveBeenCalledExactlyOnceWith({
      platforms: ['vrchat', 'chilloutvr'],
      filter: 'all'
    })
    await waitFor(() => expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy())
    // Keyboard focus stays on Clear: `disabled` would drop it to the page.
    expect(document.activeElement).toBe(clear)
    expect(clear.disabled).toBe(false)
    expect(clear.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(clear)
    expect(clearActivity).toHaveBeenCalledTimes(1)
  })

  it('keeps an entry a newer one pushed off the list, until a Clear', async () => {
    useSettingsStore.setState({ settings: SESSION_ONLY })
    const first = entries[0]
    if (first === undefined) throw new Error('no entries')
    let list = entries
    Object.defineProperty(window, 'vrx', {
      configurable: true,
      value: { getActivity: () => Promise.resolve(list), clearActivity, getActivityPage }
    })
    renderView()
    // Main keeps only the newest: a new entry arrives and the oldest leaves.
    list = [{ ...first, id: 5, at: now }, ...entries.slice(0, 3)]
    await act(() => client.refetchQueries({ queryKey: activityKey }))
    await waitFor(() => expect(rowTexts()).toHaveLength(5))
    expect(rowTexts().some((text) => text.includes('Former Friend'))).toBe(true)

    list = []
    fireEvent.click(screen.getByRole('button', { name: msg('activity.clearAria') }))
    await waitFor(() => expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy())
  })

  it('clears only what is on screen: the filtered platform and the shown kind', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    useSettingsStore.setState({ settings: { ...SESSION_ONLY, activityFilter: 'online' } })
    renderView()
    expect(rowTexts()).toEqual([expect.stringContaining('Former Friend')])
    fireEvent.click(screen.getByRole('button', { name: msg('activity.clearAria') }))
    expect(clearActivity).toHaveBeenCalledExactlyOnceWith({
      platforms: ['vrchat'],
      filter: 'online'
    })
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0))
    // ChilloutVR's history and VRChat's other kinds are still there.
    expect(client.getQueryData<ActivityEntry[]>(activityKey)?.map((entry) => entry.id)).toEqual([
      4, 3, 2
    ])
  })

  it('asks before Clear deletes saved activity, and Cancel deletes nothing', async () => {
    renderView()
    const clear = screen.getByRole('button', { name: msg('activity.clearAria') })
    fireEvent.click(clear)
    const dialog = screen.getByRole('dialog', { name: msg('activity.clearConfirm.title') })
    expect(within(dialog).getByText(msg('activity.clearConfirm.body'))).toBeTruthy()
    expect(clearActivity).not.toHaveBeenCalled()

    fireEvent.click(
      within(dialog).getByRole('button', { name: msg('activity.clearConfirm.cancel') })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(clearActivity).not.toHaveBeenCalled()
    expect(screen.getAllByRole('listitem')).toHaveLength(entries.length)

    fireEvent.click(clear)
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg('activity.clearConfirm.confirm')
      })
    )
    expect(clearActivity).toHaveBeenCalledExactlyOnceWith({
      platforms: ['vrchat', 'chilloutvr'],
      filter: 'all'
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy())
  })

  it('says how long activity is kept and lets the user change it', () => {
    renderView()
    const keep = screen.getByRole('button', {
      name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.90d') })
    })
    expect(keep.textContent).toBe(
      msg('activity.keep.button', { choice: msg('activity.keep.options.90d') })
    )
    fireEvent.click(keep)
    const dialog = screen.getByRole('dialog', { name: msg('activity.keep.title') })
    const options = within(dialog).getAllByRole<HTMLInputElement>('radio')
    expect(options.map((option) => option.value)).toEqual([
      'session',
      '30d',
      '90d',
      '1y',
      'forever'
    ])
    expect(options.find((option) => option.checked)?.value).toBe('90d')

    fireEvent.click(within(dialog).getByRole('radio', { name: msg('activity.keep.options.1y') }))
    expect(useSettingsStore.getState().settings.activityKeepFor).toBe('1y')
    fireEvent.click(within(dialog).getByRole('button', { name: msg('activity.keep.done') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.1y') })
      })
    ).toBeTruthy()
  })

  it('asks before a shorter choice deletes saved history, and deletes nothing until the answer', () => {
    renderView()
    fireEvent.click(
      screen.getByRole('button', {
        name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.90d') })
      })
    )
    const dialog = screen.getByRole('dialog', { name: msg('activity.keep.title') })
    const radio = (key: string): HTMLInputElement =>
      within(dialog).getByRole<HTMLInputElement>('radio', { name: msg(key) })
    const keptFor = (): string => useSettingsStore.getState().settings.activityKeepFor

    // One arrow key lands here: the pick shows, the setting has not changed.
    fireEvent.click(radio('activity.keep.options.30d'))
    expect(radio('activity.keep.options.30d').checked).toBe(true)
    expect(keptFor()).toBe('90d')
    expect(
      within(dialog).getByText(
        msg('activity.keep.askShorter', { choice: msg('activity.keep.options.30d') })
      )
    ).toBeTruthy()

    // Cancel puts the radio back.
    fireEvent.click(within(dialog).getByRole('button', { name: msg('activity.keep.askCancel') }))
    expect(radio('activity.keep.options.90d').checked).toBe(true)
    expect(keptFor()).toBe('90d')
    expect(within(dialog).queryByText(msg('activity.keep.askConfirm'))).toBeNull()

    // "Until VRX closes" says it takes everything, and only the answer applies it.
    fireEvent.click(radio('activity.keep.options.session'))
    expect(within(dialog).getByText(msg('activity.keep.askSession'))).toBeTruthy()
    expect(keptFor()).toBe('90d')
    fireEvent.click(within(dialog).getByRole('button', { name: msg('activity.keep.askConfirm') }))
    expect(keptFor()).toBe('session')
    expect(within(dialog).queryByText(msg('activity.keep.askSession'))).toBeNull()

    // From nothing saved, every choice is longer and applies at once.
    fireEvent.click(radio('activity.keep.options.forever'))
    expect(keptFor()).toBe('forever')
  })

  it('drops an unanswered shorter pick when the dialog closes', () => {
    renderView()
    fireEvent.click(
      screen.getByRole('button', {
        name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.90d') })
      })
    )
    const dialog = screen.getByRole('dialog', { name: msg('activity.keep.title') })
    fireEvent.click(
      within(dialog).getByRole('radio', { name: msg('activity.keep.options.session') })
    )
    fireEvent.click(within(dialog).getByRole('button', { name: msg('activity.keep.done') }))
    expect(useSettingsStore.getState().settings.activityKeepFor).toBe('90d')
    expect(
      screen.getByRole('button', {
        name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.90d') })
      })
    ).toBeTruthy()
  })

  it('keeps the oldest full-page entry when Kept changes and a newer one arrives', async () => {
    const full: ActivityEntry[] = Array.from(
      { length: ACTIVITY_MAX_ENTRIES_PER_PLATFORM },
      (_, index) => ({
        id: 1_000 - index,
        kind: 'online',
        platform: 'vrchat',
        platformUserId:
          index === ACTIVITY_MAX_ENTRIES_PER_PLATFORM - 1 ? 'usr_oldest' : alice.platformUserId,
        displayName: index === ACTIVITY_MAX_ENTRIES_PER_PLATFORM - 1 ? 'Oldest Friend' : 'Alice',
        worldName: null,
        at: now - index * 1_000
      })
    )
    const oldestId = 1_000 - (ACTIVITY_MAX_ENTRIES_PER_PLATFORM - 1)
    let list = full
    Object.defineProperty(window, 'vrx', {
      configurable: true,
      value: { getActivity: () => Promise.resolve(list), clearActivity, getActivityPage }
    })
    renderView(full)
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: msg('activity.keep.buttonAria', { choice: msg('activity.keep.options.90d') })
      })
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: msg('activity.keep.title') })).getByRole('radio', {
        name: msg('activity.keep.options.1y')
      })
    )
    // The save has answered: main has applied the longer choice and deleted nothing.
    act(() => useSettingsStore.getState().markSaved())

    list = [
      {
        id: 1_001,
        kind: 'online',
        platform: 'vrchat',
        platformUserId: 'usr_newest',
        displayName: 'Brand New',
        worldName: null,
        at: now
      },
      ...full.slice(0, -1)
    ]
    await act(() => client.refetchQueries({ queryKey: activityKey }))

    await waitFor(() => expect(screen.getByText('Brand New')).toBeTruthy())
    // The reader started strictly below this entry, so Show older cannot bring it back.
    expect(getActivityPage).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: [{ platform: 'vrchat', beforeId: oldestId }],
        filter: 'all'
      })
    )
    expect(screen.getByText('Oldest Friend')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(ACTIVITY_MAX_ENTRIES_PER_PLATFORM + 1)
  })

  it('offers no Show older while the list holds everything saved', async () => {
    renderView()
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(entries.length))
    expect(getActivityPage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: msg('activity.showOlder') })).toBeNull()
  })

  it('shows older saved activity a page at a time, each platform from its own place', async () => {
    // VRChat fills its allowance; ChilloutVR holds everything it has.
    const full: ActivityEntry[] = Array.from(
      { length: ACTIVITY_MAX_ENTRIES_PER_PLATFORM },
      (_, index) => ({
        id: 1_000 - index,
        kind: 'online',
        platform: 'vrchat',
        platformUserId: alice.platformUserId,
        displayName: 'Alice',
        worldName: null,
        at: now - index * 1_000
      })
    )
    const oldestLive = 1_000 - (ACTIVITY_MAX_ENTRIES_PER_PLATFORM - 1)
    const older = (id: number, worldName: string): ActivityEntry => ({
      id,
      kind: 'world',
      platform: 'vrchat',
      platformUserId: alice.platformUserId,
      displayName: 'Alice',
      worldName,
      at: now - 10_000_000 - (1_000 - id) * 1_000
    })
    getActivityPage.mockImplementation((request: ActivityPageRequest) => {
      const before = request.scope[0]?.beforeId
      if (before === oldestLive) {
        return Promise.resolve({ entries: [older(500, 'Older Lounge')], hasMore: true })
      }
      if (before === 500) {
        return Promise.resolve({ entries: [older(400, 'Oldest Lounge')], hasMore: false })
      }
      return Promise.resolve({ entries: [], hasMore: false })
    })
    renderView([...full, ...entries.filter((entry) => entry.platform === 'chilloutvr')])

    const button = await screen.findByRole('button', { name: msg('activity.showOlder') })
    // Read ahead, not shown until asked for.
    expect(getActivityPage).toHaveBeenCalledExactlyOnceWith({
      scope: [{ platform: 'vrchat', beforeId: oldestLive }],
      filter: 'all'
    })
    expect(screen.queryByText(msg('activity.joined', { world: 'Older Lounge' }))).toBeNull()

    fireEvent.click(button)
    expect(screen.getByText(msg('activity.joined', { world: 'Older Lounge' }))).toBeTruthy()
    await waitFor(() =>
      expect(getActivityPage).toHaveBeenLastCalledWith({
        scope: [{ platform: 'vrchat', beforeId: 500 }],
        filter: 'all'
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: msg('activity.showOlder') }))
    expect(screen.getByText(msg('activity.joined', { world: 'Oldest Lounge' }))).toBeTruthy()
    // Nothing older is left: the button goes away.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: msg('activity.showOlder') })).toBeNull()
    )
    // Still one list, newest first.
    const texts = rowTexts()
    const olderAt = texts.findIndex((text) => text.includes('Older Lounge'))
    expect(olderAt).toBeGreaterThanOrEqual(ACTIVITY_MAX_ENTRIES_PER_PLATFORM)
    expect(texts.findIndex((text) => text.includes('Oldest Lounge'))).toBe(olderAt + 1)
  })

  it('offers no Clear while the filtered platform has nothing stored', () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderView(entries.filter((entry) => entry.platform === 'chilloutvr'))
    expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy()
    expect(
      screen
        .getByRole<HTMLButtonElement>('button', { name: msg('activity.clearAria') })
        .getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('asks main for a debounced search, inclusive dates and the kind, and pages within them', async () => {
    vi.useFakeTimers()
    try {
      const night = entries[1]!
      const older: ActivityEntry = {
        ...night,
        id: 1,
        worldName: 'Older Market',
        at: night.at - 10_000
      }
      getActivityPage.mockImplementation((request: ActivityPageRequest) => {
        const before = request.scope.some((cursor) => cursor.beforeId !== null)
        if (request.query?.text === 'Night' && !before) {
          return Promise.resolve({ entries: [night], hasMore: true })
        }
        if (request.query?.text === 'Night') {
          return Promise.resolve({ entries: [older], hasMore: false })
        }
        return Promise.resolve({ entries: [], hasMore: false })
      })
      renderView()
      const field = screen.getByRole('textbox', { name: msg('activity.search.aria') })
      fireEvent.change(field, { target: { value: 'Ni' } })
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1))
      expect(getActivityPage).not.toHaveBeenCalled()
      fireEvent.change(field, { target: { value: 'Night' } })
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS))
      expect(getActivityPage).toHaveBeenCalledWith({
        scope: [
          { platform: 'vrchat', beforeId: null },
          { platform: 'chilloutvr', beforeId: null }
        ],
        filter: 'all',
        query: { text: 'Night' }
      })
      expect(screen.getByText(msg('activity.joined', { world: 'Night Market' }))).toBeTruthy()
      expect(screen.queryByText('Former Friend')).toBeNull()

      const show = screen.getByRole('radiogroup', { name: msg('activity.filterAria') })
      fireEvent.click(within(show).getByRole('radio', { name: msg('activity.kinds.world') }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(getActivityPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: 'world', query: { text: 'Night' } })
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByRole('button', { name: msg('activity.showOlder') }))
      expect(screen.getByText(msg('activity.joined', { world: 'Older Market' }))).toBeTruthy()

      fireEvent.change(field, { target: { value: 'zzzz-no-such-friend' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      })
      expect(screen.getByText(msg('activity.noMatches'))).toBeTruthy()
      expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends today as an inclusive local day and leaves Clear off while dates narrow the list', async () => {
    getActivityPage.mockResolvedValue({ entries: [], hasMore: false })
    renderView()
    fireEvent.click(screen.getByRole('radio', { name: msg('activity.range.today') }))
    const bounds = activityDateBounds('today', new Date(), '', '')
    await waitFor(() =>
      expect(getActivityPage).toHaveBeenCalledWith({
        scope: [
          { platform: 'vrchat', beforeId: null },
          { platform: 'chilloutvr', beforeId: null }
        ],
        filter: 'all',
        query: bounds
      })
    )
    expect(screen.getByText(msg('activity.noMatches'))).toBeTruthy()
    expect(
      screen
        .getByRole<HTMLButtonElement>('button', { name: msg('activity.clearFiltered') })
        .getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('drops a search match after a shorter Keep for choice is applied', async () => {
    const match = entries[1]!
    let deleted = false
    getActivityPage.mockImplementation(() =>
      Promise.resolve({ entries: deleted ? [] : [match], hasMore: !deleted })
    )
    renderView()
    fireEvent.change(screen.getByRole('textbox', { name: msg('activity.search.aria') }), {
      target: { value: 'Night' }
    })
    await waitFor(() => {
      expect(screen.getByText(msg('activity.joined', { world: 'Night Market' }))).toBeTruthy()
      expect(screen.queryByText('Former Friend')).toBeNull()
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: msg('activity.showOlder') })).toBeTruthy()
    )

    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: '30d' }))
    expect(screen.getByText(msg('activity.joined', { world: 'Night Market' }))).toBeTruthy()

    deleted = true
    act(() => useSettingsStore.getState().markSaved())
    await waitFor(() =>
      expect(screen.queryByText(msg('activity.joined', { world: 'Night Market' }))).toBeNull()
    )
    expect(screen.getByText(msg('activity.noMatches'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('activity.showOlder') })).toBeNull()
  })

  it('shows a world name that arrives while a search is active', async () => {
    const match = { ...entries[1]!, worldName: 'Aurora Transit' }
    getActivityPage.mockResolvedValue({ entries: [], hasMore: false })
    renderView()
    fireEvent.change(screen.getByRole('textbox', { name: msg('activity.search.aria') }), {
      target: { value: 'Aurora' }
    })
    await waitFor(() => expect(screen.getByText(msg('activity.noMatches'))).toBeTruthy())

    getActivityPage.mockResolvedValue({ entries: [match], hasMore: false })
    act(() => {
      client.setQueryData(
        activityKey,
        entries.map((entry) => (entry.id === match.id ? match : entry))
      )
    })
    await waitFor(() =>
      expect(screen.getByText(msg('activity.joined', { world: 'Aurora Transit' }))).toBeTruthy()
    )
    expect(screen.queryByText(msg('activity.noMatches'))).toBeNull()
  })

  it('reads the open list again when history changes and no search is on', async () => {
    const full: ActivityEntry[] = Array.from(
      { length: ACTIVITY_MAX_ENTRIES_PER_PLATFORM },
      (_, index) => ({
        id: 800 - index,
        kind: 'online' as const,
        platform: 'vrchat' as const,
        platformUserId: alice.platformUserId,
        displayName: 'Alice',
        worldName: null,
        at: now - index * 1_000
      })
    )
    renderView(full)
    await waitFor(() => expect(getActivityPage).toHaveBeenCalled())
    const before = getActivityPage.mock.calls.length
    act(() => {
      client.setQueryData(
        activityKey,
        full.map((entry, index) => (index === 0 ? { ...entry, worldName: 'Filled In' } : entry))
      )
    })
    await waitFor(() => expect(getActivityPage.mock.calls.length).toBeGreaterThan(before))
  })

  it('asks to connect a single filtered platform that is signed out', () => {
    authState.value = 'unauthenticated'
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderView()
    expect(screen.getByText(msg('activity.notConnected.vrchat'))).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('subscribeActivity', () => {
  it('re-reads on a change push and drops a platform at its account boundary', () => {
    let onChanged: (() => void) | undefined
    let onBoundary: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined
    const unsubscribeChanged = vi.fn()
    const unsubscribeBoundary = vi.fn()
    Object.defineProperty(window, 'vrx', {
      configurable: true,
      value: {
        getActivity: vi.fn(() => Promise.resolve(entries)),
        onActivityChanged: (callback: () => void) => {
          onChanged = callback
          return unsubscribeChanged
        },
        onIdentityBoundary: (callback: typeof onBoundary) => {
          onBoundary = callback
          return unsubscribeBoundary
        }
      }
    })
    const queryClient = new QueryClient()
    queryClient.setQueryData(activityKey, entries)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const stop = subscribeActivity(queryClient)

    onChanged?.()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: activityKey })

    onBoundary?.({ platform: 'vrchat' })
    expect(
      queryClient.getQueryData<ActivityEntry[]>(activityKey)?.map((entry) => entry.platform)
    ).toEqual(['chilloutvr', 'chilloutvr'])

    stop()
    expect(unsubscribeChanged).toHaveBeenCalledOnce()
    expect(unsubscribeBoundary).toHaveBeenCalledOnce()
  })
})
