// @vitest-environment jsdom
/**
 * Inbox page (owner, 2026-10-27): rows for both platforms, scoped by the
 * platform filter, with Hide acting in VRX only. Friend requests can be
 * accepted or declined (owner, 2026-11-01).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxItem, InboxSnapshot } from '@shared/inbox'
import type { Friend } from '@shared/types'
import { fullFriend } from '../test-utils/friendFixture'
import { translate as msg } from '../i18n/translate'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import { inboxKey } from '../queries/inbox'
import InboxView from './InboxView'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
const authState = vi.hoisted(() => ({ state: 'authenticated' }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: authState.state, accountId: `${platform}-test`, displayName: 'T' },
    isSuccess: true,
    isFetching: false
  })
}))

const NOW = Date.UTC(2026, 9, 27, 8, 0, 0)

const item = (overrides: Partial<InboxItem>): InboxItem => ({
  id: 'invite:not_1',
  platform: 'vrchat',
  kind: 'invite',
  senderId: 'usr_a',
  senderName: 'Alice',
  worldName: 'Pug Lounge',
  receivedAt: NOW - 5 * 60_000,
  ...overrides
})

let snapshot: InboxSnapshot
let bridge: {
  getInbox: ReturnType<typeof vi.fn>
  dismissInboxItem: ReturnType<typeof vi.fn>
  clearInbox: ReturnType<typeof vi.fn>
  answerFriendRequest: ReturnType<typeof vi.fn>
}

function renderInbox(friends: { vrchat?: Friend[]; chilloutvr?: Friend[] } = {}): QueryClient {
  useFriendsMock.mockImplementation((platform: 'vrchat' | 'chilloutvr') => ({
    data: friends[platform] ?? [],
    isPending: false
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <InboxView />
    </QueryClientProvider>
  )
  return client
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  snapshot = {
    items: [
      item({}),
      item({
        id: 'friend-request:g-1',
        platform: 'chilloutvr',
        kind: 'friend-request',
        senderId: 'g-1',
        senderName: 'Bob',
        worldName: null,
        receivedAt: NOW - 30_000
      }),
      item({
        id: 'invite-request:r-1',
        platform: 'chilloutvr',
        kind: 'invite-request',
        senderId: 'g-2',
        senderName: null,
        worldName: null,
        receivedAt: NOW - 3 * 60 * 60_000
      })
    ]
  }
  bridge = {
    getInbox: vi.fn(async () => snapshot),
    dismissInboxItem: vi.fn(async () => undefined),
    clearInbox: vi.fn(async () => undefined),
    answerFriendRequest: vi.fn(async ({ platform, id }: { platform: string; id: string }) => {
      snapshot = {
        items: snapshot.items.filter((row) => !(row.platform === platform && row.id === id))
      }
      return { ok: true }
    })
  }
  vi.stubGlobal('vrx', bridge)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useFriendsMock.mockReset()
  authState.state = 'authenticated'
  useFriendsStore.setState({ platformFilter: 'all' })
  useUiStore.setState({ inboxSeenAt: { vrchat: 0, chilloutvr: 0 } })
})

describe('InboxView', () => {
  it('lists invites and friend requests from both platforms with words for each', async () => {
    renderInbox()
    const invites = await screen.findByRole('region', { name: msg('inbox.invitesHeading') })
    const requests = screen.getByRole('region', { name: msg('inbox.requestsHeading') })

    const inviteRows = within(invites).getAllByRole('listitem')
    expect(inviteRows).toHaveLength(2)
    expect(inviteRows[0]!.textContent).toContain('Alice')
    expect(inviteRows[0]!.textContent).toContain(msg('inbox.invite', { world: 'Pug Lounge' }))
    expect(inviteRows[0]!.textContent).toContain('5 minutes ago')
    expect(inviteRows[0]!.textContent).toContain(msg('dashboard.platformVrc'))
    // A missing name reads as "Someone", never a blank.
    expect(inviteRows[1]!.textContent).toContain(msg('inbox.someone'))
    expect(inviteRows[1]!.textContent).toContain(msg('inbox.inviteRequest'))
    expect(inviteRows[1]!.textContent).toContain(msg('dashboard.platformCvr'))

    const requestRow = within(requests).getByRole('listitem')
    expect(requestRow.textContent).toContain('Bob')
    expect(requestRow.textContent).toContain(msg('inbox.friendRequest'))
    expect(requestRow.textContent).toContain(msg('inbox.justNow'))
    expect(screen.getByText(msg('inbox.count', { count: 3 }))).toBeTruthy()
  })

  it('follows the platform filter', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderInbox()
    await screen.findByText('Alice')
    expect(screen.queryByText('Bob')).toBeNull()
    expect(screen.queryByRole('region', { name: msg('inbox.requestsHeading') })).toBeNull()
  })

  it("shows a known friend's current name", async () => {
    renderInbox({
      vrchat: [{ ...fullFriend('Alice Now', 'vrchat'), platformUserId: 'usr_a' }]
    })
    expect(await screen.findByText('Alice Now')).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
  })

  it('hides a row in VRX only and keeps focus in the list', async () => {
    const client = renderInbox()
    const hide = await screen.findByRole('button', {
      name: msg('inbox.hideInviteAria', { name: 'Alice' })
    })
    fireEvent.click(hide)
    await waitFor(() =>
      expect(bridge.dismissInboxItem).toHaveBeenCalledWith({
        platform: 'vrchat',
        id: 'invite:not_1'
      })
    )
    // Main pushes the change; the next read no longer has the row.
    snapshot = { items: snapshot.items.slice(1) }
    await client.invalidateQueries({ queryKey: inboxKey })
    await waitFor(() => expect(screen.queryByText('Alice')).toBeNull())
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      msg('inbox.hideInviteRequestAria', { name: msg('inbox.someone') })
    )
  })

  it('leaves focus where the user moved it while a row was on its way out', async () => {
    const client = renderInbox()
    const hide = await screen.findByRole('button', {
      name: msg('inbox.hideInviteAria', { name: 'Alice' })
    })
    hide.focus()
    fireEvent.click(hide)
    await waitFor(() => expect(bridge.dismissInboxItem).toHaveBeenCalledTimes(1))
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    elsewhere.focus()
    snapshot = { items: snapshot.items.slice(1) }
    await client.invalidateQueries({ queryKey: inboxKey })
    await waitFor(() => expect(screen.queryByText('Alice')).toBeNull())
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('keeps keyboard focus when a newer invite from the same person replaces a row', async () => {
    const client = renderInbox()
    const hide = await screen.findByRole('button', {
      name: msg('inbox.hideInviteAria', { name: 'Alice' })
    })
    hide.focus()
    // Main keeps one row per sender and kind: Alice's newer invite takes the
    // older one's place under a new id.
    snapshot = {
      items: [
        item({ id: 'invite:not_3', worldName: 'Moon Base', receivedAt: NOW - 60_000 }),
        ...snapshot.items.slice(1)
      ]
    }
    await client.invalidateQueries({ queryKey: inboxKey })
    await screen.findByText(/Moon Base/)
    expect(document.activeElement).toBe(hide)
    expect(hide.isConnected).toBe(true)
  })

  it('Hide all clears only the platforms on screen', async () => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderInbox()
    fireEvent.click(await screen.findByRole('button', { name: msg('inbox.hideAll') }))
    await waitFor(() =>
      expect(bridge.clearInbox).toHaveBeenCalledWith({ platforms: ['chilloutvr'] })
    )
  })

  it('says so when hiding fails, and keeps the row', async () => {
    bridge.dismissInboxItem.mockRejectedValue(new Error('rate_limited'))
    renderInbox()
    fireEvent.click(
      await screen.findByRole('button', { name: msg('inbox.hideInviteAria', { name: 'Alice' }) })
    )
    expect((await screen.findByRole('alert')).textContent).toBe(msg('inbox.hideFailed'))
    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it('marks what is on screen as seen, per platform', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    renderInbox()
    await screen.findByText('Alice')
    expect(useUiStore.getState().inboxSeenAt).toEqual({ vrchat: NOW - 5 * 60_000, chilloutvr: 0 })
  })

  it('shows the empty state and the help text on demand', async () => {
    snapshot = { items: [] }
    renderInbox()
    expect(await screen.findByText(msg('inbox.emptyHeading'))).toBeTruthy()
    // The hint wraps into even lines, never leaving one word alone.
    expect(screen.getByText(msg('inbox.emptyHint')).className).toContain('text-balance')
    expect(screen.queryByRole('button', { name: msg('inbox.hideAll') })).toBeNull()
    const help = screen.getByRole('button', { name: msg('inbox.help.label') })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(msg('inbox.help.answer'))).toBeTruthy()
  })

  it('offers Accept and Decline on friend requests only, and sends one answer', async () => {
    const client = renderInbox()
    const requests = await screen.findByRole('region', { name: msg('inbox.requestsHeading') })
    const invites = screen.getByRole('region', { name: msg('inbox.invitesHeading') })
    expect(within(invites).queryByRole('button', { name: /accept/i })).toBeNull()

    fireEvent.click(
      within(requests).getByRole('button', {
        name: msg('friendActions.acceptAria', { name: 'Bob' })
      })
    )
    await waitFor(() =>
      expect(bridge.answerFriendRequest).toHaveBeenCalledWith({
        platform: 'chilloutvr',
        id: 'friend-request:g-1',
        answer: 'accept'
      })
    )
    expect((await screen.findByRole('status')).textContent).toBe(
      msg('friendActions.accepted', { name: 'Bob' })
    )
    // Main pushes inbox-changed; the row leaves on the re-read.
    await client.invalidateQueries({ queryKey: inboxKey })
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull())
    expect(bridge.answerFriendRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps the row and names the platform when an answer fails', async () => {
    let fail: (result: { ok: false; reason: 'unavailable' }) => void = () => undefined
    bridge.answerFriendRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = resolve
        })
    )
    renderInbox()
    const decline = await screen.findByRole<HTMLButtonElement>('button', {
      name: msg('friendActions.declineAria', { name: 'Bob' })
    })
    decline.focus()
    fireEvent.click(decline)
    // Keyboard focus stays on the pressed button while it sends and after it
    // fails: `disabled` would drop it to the page. More presses send nothing.
    await waitFor(() => expect(decline.getAttribute('aria-disabled')).toBe('true'))
    expect(decline.disabled).toBe(false)
    expect(document.activeElement).toBe(decline)
    fireEvent.click(decline)
    fireEvent.click(
      screen.getByRole('button', { name: msg('friendActions.acceptAria', { name: 'Bob' }) })
    )
    expect(bridge.answerFriendRequest).toHaveBeenCalledTimes(1)
    act(() => fail({ ok: false, reason: 'unavailable' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        msg('friendActions.error.unavailable', { platform: 'ChilloutVR' })
      )
    )
    expect(document.activeElement).toBe(decline)
    expect(decline.getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(bridge.answerFriendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'decline' })
    )
  })

  it('offers Accounts when the filtered platform is not connected', async () => {
    authState.state = 'unauthenticated'
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderInbox()
    expect(await screen.findByText(msg('inbox.notConnected.chilloutvr'))).toBeTruthy()
  })
})
