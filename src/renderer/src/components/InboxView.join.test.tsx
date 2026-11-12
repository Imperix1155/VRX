// @vitest-environment jsdom
/**
 * Join straight from an invite (owner, 2026-11-11): an invite row that named
 * its instance has a Join. The page and the shared join dialog run together
 * here, against the real join store, so a press is followed all the way to
 * the one bridge call. The renderer names the row and never a place.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  act,
  render,
  renderHook,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxItem, InboxSnapshot } from '@shared/inbox'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { inboxKey } from '../queries/inbox'
import { useJoinInstance } from '../hooks/useJoinInstance'
import InboxView from './InboxView'
import JoinConfirmDialog from './JoinConfirmDialog'

vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: () => ({ data: [], isPending: false })
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: 'authenticated', accountId: `${platform}-test`, displayName: 'T' },
    isSuccess: true,
    isFetching: false
  })
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)
const NOW = Date.UTC(2026, 10, 11, 8, 0, 0)

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'invite:not_1',
  platform: 'vrchat',
  kind: 'invite',
  senderId: 'usr_a',
  senderName: 'Alice',
  worldName: 'Pug Lounge',
  receivedAt: NOW - 5 * 60_000,
  canJoin: true,
  ...overrides
})

const cvrInvite = item({
  id: 'invite:inv-1',
  platform: 'chilloutvr',
  senderId: 'g-1',
  senderName: 'Bob',
  worldName: 'Cafe',
  receivedAt: NOW - 60_000
})

let snapshot: InboxSnapshot
let joinInvite: ReturnType<typeof vi.fn>
let client: QueryClient

function renderInbox(): void {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <InboxView />
      <JoinConfirmDialog />
    </QueryClientProvider>
  )
}

const settings = (overrides: Partial<typeof DEFAULT_SETTINGS>): void =>
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...overrides }, dirty: false })

const joinButton = (name: string): HTMLElement =>
  screen.getByRole('button', { name: msg('inbox.join.aria', { name }) })

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  snapshot = { items: [item(), cvrInvite] }
  joinInvite = vi.fn(async () => ({ ok: true, handoff: 'launch' }))
  vi.stubGlobal('vrx', {
    getInbox: vi.fn(async () => snapshot),
    dismissInboxItem: vi.fn(async () => undefined),
    clearInbox: vi.fn(async () => undefined),
    joinInvite
  })
  settings({ confirmJoin: false })
})

afterEach(() => {
  // The join store is module-level: close any parked confirmation.
  const { result } = renderHook(() => useJoinInstance())
  act(() => result.current.invalidatePending())
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useFriendsStore.setState({ platformFilter: 'all' })
  useUiStore.setState({ inboxSeenAt: { vrchat: 0, chilloutvr: 0 } })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})

describe('Inbox: Join on an invite', () => {
  it('offers Join only on an invite that named its instance, the same for both platforms', async () => {
    snapshot = {
      items: [
        item(),
        cvrInvite,
        item({ id: 'invite:not_2', senderId: 'usr_c', senderName: 'Cara', canJoin: undefined }),
        item({ id: 'invite:not_3', senderId: 'usr_d', senderName: 'Dee', canJoin: false }),
        item({
          id: 'invite-request:r-1',
          kind: 'invite-request',
          senderId: 'usr_e',
          senderName: 'Eve',
          worldName: null,
          canJoin: true
        }),
        item({
          id: 'friend-request:f-1',
          kind: 'friend-request',
          senderId: 'usr_f',
          senderName: 'Finn',
          worldName: null,
          canJoin: true
        })
      ]
    }
    renderInbox()
    await screen.findByText('Alice')
    expect(document.querySelectorAll('[data-inbox-join]')).toHaveLength(2)
    expect(joinButton('Alice').textContent).toBe(msg('inbox.join.button'))
    expect(joinButton('Bob').textContent).toBe(msg('inbox.join.button'))
    for (const name of ['Cara', 'Dee', 'Eve', 'Finn']) {
      expect(screen.queryByRole('button', { name: msg('inbox.join.aria', { name }) })).toBeNull()
    }
  })

  it('names the row to main once, and nothing about a place', async () => {
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    await waitFor(() => expect(joinInvite).toHaveBeenCalledTimes(1))
    expect(joinInvite).toHaveBeenCalledWith({
      platform: 'vrchat',
      id: 'invite:not_1',
      mode: 'desktop'
    })
    // The row stays: a Join answers nothing and hides nothing.
    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it("passes ChilloutVR's saved launch mode", async () => {
    settings({ confirmJoin: false, joinMode: 'vr' })
    renderInbox()
    await screen.findByText('Bob')
    fireEvent.click(joinButton('Bob'))
    await waitFor(() =>
      expect(joinInvite).toHaveBeenCalledWith({
        platform: 'chilloutvr',
        id: 'invite:inv-1',
        mode: 'vr'
      })
    )
  })

  it('sends one Join for a double press', async () => {
    let finish: (value: unknown) => void = () => undefined
    joinInvite.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    fireEvent.click(joinButton('Alice'))
    fireEvent.click(joinButton('Bob'))
    expect(joinInvite).toHaveBeenCalledTimes(1)
    expect(joinButton('Bob').getAttribute('aria-disabled')).toBe('true')
    await act(async () => finish({ ok: true, handoff: 'launch' }))
    expect(joinButton('Bob').getAttribute('aria-disabled')).toBe('false')
  })

  it.each([
    ['stale', 'inbox.join.gone'],
    ['invalid-url', 'inbox.join.failed'],
    ['cooldown', 'friends.joinFailure.cooldown'],
    ['rate-limited', 'friends.joinFailure.rateLimited'],
    ['joining-disabled', 'friends.joinFailure.joiningDisabled'],
    ['launch-failed', 'friends.joinFailure.launchFailed'],
    ['invite-failed', 'friends.joinFailure.inviteFailed']
  ])('says what happened under the row when main answers %s', async (reason, key) => {
    joinInvite.mockResolvedValueOnce({ ok: false, reason })
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const row = joinButton('Alice').closest('li')!
    await waitFor(() =>
      expect(row.querySelector('[data-inbox-join-feedback]')?.textContent).toBe(msg(key))
    )
    // Attributed: the other invite says nothing.
    const other = joinButton('Bob').closest('li')!
    expect(other.querySelector('[data-inbox-join-feedback]')?.textContent).toBe('')
  })

  it('says so when the bridge throws, and lets the user try again', async () => {
    joinInvite.mockRejectedValueOnce(new Error('ipc'))
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const row = joinButton('Alice').closest('li')!
    await waitFor(() =>
      expect(row.querySelector('[data-inbox-join-feedback]')?.textContent).toBe(
        msg('friends.joinFailed')
      )
    )
    fireEvent.click(joinButton('Alice'))
    await waitFor(() => expect(joinInvite).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(row.querySelector('[data-inbox-join-feedback]')?.textContent).toBe('')
    )
  })

  it('notes a Join that reached a game which was already open', async () => {
    joinInvite.mockResolvedValueOnce({ ok: true, handoff: 'in-game' })
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const row = joinButton('Alice').closest('li')!
    await waitFor(() =>
      expect(row.querySelector('[data-inbox-join-feedback]')?.textContent).toBe(
        msg('friends.joinNotice.inGame')
      )
    )
  })

  it('sends nothing while joining is turned off in Settings', async () => {
    settings({ allowJoinInstances: false })
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    expect(joinInvite).not.toHaveBeenCalled()
    expect(
      joinButton('Alice').closest('li')!.querySelector('[data-inbox-join-feedback]')?.textContent
    ).toBe(msg('friends.joinFailure.joiningDisabled'))
  })
})

describe('Inbox: Join on an invite, with the confirmation on', () => {
  beforeEach(() => settings({ confirmJoin: true }))

  it('asks first, showing the world and who sent it, and Cancel sends nothing', async () => {
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const dialog = screen.getByRole('dialog', { name: 'Pug Lounge' })
    expect(within(dialog).getByText(msg('inbox.join.context', { name: 'Alice' }))).toBeTruthy()
    expect(within(dialog).getByText(msg('dashboard.platformVrc'))).toBeTruthy()
    // What is not known is not shown: no access pill, no people count.
    expect(dialog.textContent).not.toContain(msg('explore.countUnknown'))
    expect(joinInvite).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: msg('joinConfirm.cancel') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(joinInvite).not.toHaveBeenCalled()
  })

  it('joins once on Join and closes', async () => {
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const dialog = screen.getByRole('dialog', { name: 'Pug Lounge' })
    fireEvent.click(within(dialog).getByRole('button', { name: msg('joinConfirm.confirm') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(joinInvite).toHaveBeenCalledExactlyOnceWith({
      platform: 'vrchat',
      id: 'invite:not_1',
      mode: 'desktop'
    })
  })

  it('titles an invite that named no world by its sender', async () => {
    snapshot = { items: [item({ worldName: null })] }
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    expect(
      screen.getByRole('dialog', { name: msg('inbox.join.titleNoWorld', { name: 'Alice' }) })
    ).toBeTruthy()
  })

  it('lets a ChilloutVR invite pick VR or desktop', async () => {
    settings({ confirmJoin: true, joinMode: 'ask' })
    renderInbox()
    await screen.findByText('Bob')
    fireEvent.click(joinButton('Bob'))
    const dialog = screen.getByRole('dialog', { name: 'Cafe' })
    fireEvent.click(within(dialog).getByRole('radio', { name: msg('joinConfirm.mode.vr') }))
    fireEvent.click(within(dialog).getByRole('button', { name: msg('joinConfirm.confirm') }))
    await waitFor(() =>
      expect(joinInvite).toHaveBeenCalledExactlyOnceWith({
        platform: 'chilloutvr',
        id: 'invite:inv-1',
        mode: 'vr'
      })
    )
  })

  it('keeps the VR or desktop picker to one Tab stop inside the dialog', async () => {
    settings({ confirmJoin: true, joinMode: 'ask' })
    renderInbox()
    await screen.findByText('Bob')
    fireEvent.click(joinButton('Bob'))
    const dialog = screen.getByRole('dialog', { name: 'Cafe' })
    const radios = within(dialog).getAllByRole('radio')
    const stops = radios.filter((radio) => radio.getAttribute('tabindex') !== '-1')
    expect(radios.length).toBe(2)
    expect(stops.length).toBe(1)
    // Tab from the last control wraps to the picker's one stop, never to the other option.
    const last = within(dialog).getByRole('button', { name: msg('joinConfirm.dontAskAgain') })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(stops[0])
    // And backward from the first stop to the last control.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('stops the Join when the invite leaves while the dialog is open', async () => {
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    const dialog = screen.getByRole('dialog', { name: 'Pug Lounge' })
    snapshot = { items: [cvrInvite] }
    await act(async () => {
      await client.invalidateQueries({ queryKey: inboxKey })
    })
    await waitFor(() => expect(within(dialog).getByText(msg('inbox.join.gone'))).toBeTruthy())
    const confirm = within(dialog).getByRole('button', { name: msg('joinConfirm.confirm') })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm)
    expect(joinInvite).not.toHaveBeenCalled()
  })

  it('reports a refusal under the row after the dialog closes', async () => {
    joinInvite.mockResolvedValueOnce({ ok: false, reason: 'stale' })
    renderInbox()
    await screen.findByText('Alice')
    fireEvent.click(joinButton('Alice'))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: msg('joinConfirm.confirm') })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      joinButton('Alice').closest('li')!.querySelector('[data-inbox-join-feedback]')?.textContent
    ).toBe(msg('inbox.join.gone'))
  })
})
