// @vitest-environment jsdom
/**
 * The instance log on screen (owner, 2026-11-15): the Activity page's
 * Instances tab, and what a friend's History says from it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FriendHistoryFacts } from '@shared/activity'
import type { InstanceVisit, InstanceVisitPageRequest } from '@shared/instanceLog'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { translate as msg } from '../i18n/translate'
import '../i18n'
import { activityKey, subscribeActivity } from '../queries/activity'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { fullFriend } from '../test-utils/friendFixture'
import ActivityView from './ActivityView'
import FriendHistoryDialog from './FriendHistoryDialog'

vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: () => ({ data: [], isPending: false })
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: 'authenticated', accountId: null, displayName: null },
    isSuccess: true,
    isFetching: false,
    isPending: false
  })
}))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const HOUR = 3_600_000
const now = Date.now()
const visits: InstanceVisit[] = [
  {
    id: 3,
    platform: 'vrchat',
    worldName: 'Night Market',
    enteredAt: now - HOUR,
    leftAt: null,
    current: true,
    people: 2
  },
  {
    id: 2,
    platform: 'chilloutvr',
    worldName: 'Sunset Bay (#42)',
    enteredAt: now - 5 * HOUR,
    leftAt: now - 5 * HOUR + 90 * 60_000,
    current: false,
    people: 1
  },
  {
    id: 1,
    platform: 'vrchat',
    worldName: null,
    enteredAt: now - 30 * HOUR,
    leftAt: null,
    current: false,
    people: 0
  }
]

const getInstanceVisits = vi.fn((request: InstanceVisitPageRequest) =>
  Promise.resolve({
    visits: visits.filter((visit) =>
      request.scope.some((cursor) => cursor.platform === visit.platform && cursor.before === null)
    ),
    hasMore: false
  })
)
const getInstanceVisitPeople = vi.fn(() =>
  Promise.resolve([
    { platformUserId: 'usr_a', displayName: 'Alice', joinedAt: now - HOUR, leftAt: null },
    { platformUserId: 'usr_b', displayName: 'Bob', joinedAt: now - HOUR, leftAt: now - 60_000 }
  ])
)
const clearInstanceLog = vi.fn(() => Promise.resolve())
const getFriendHistory = vi.fn((): Promise<FriendHistoryFacts[]> => Promise.resolve([]))
let boundary: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | null = null
let client: QueryClient

function renderWith(node: React.JSX.Element): void {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(activityKey, [])
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

async function openInstances(): Promise<void> {
  renderWith(<ActivityView />)
  fireEvent.click(screen.getByRole('radio', { name: msg('activity.kinds.instances') }))
  await screen.findByText('Night Market')
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
  boundary = null
  Object.defineProperty(window, 'vrx', {
    configurable: true,
    value: {
      getActivity: () => Promise.resolve([]),
      getActivityPage: () => Promise.resolve({ entries: [], hasMore: false }),
      getInstanceVisits,
      getInstanceVisitPeople,
      clearInstanceLog,
      getFriendHistory,
      onIdentityBoundary: (callback: typeof boundary) => {
        boundary = callback
        return () => undefined
      }
    }
  })
})

afterEach(() => {
  cleanup()
  getInstanceVisits.mockClear()
  getInstanceVisitPeople.mockClear()
  clearInstanceLog.mockClear()
  getFriendHistory.mockReset()
  getFriendHistory.mockImplementation(() => Promise.resolve([]))
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('the Instances tab', () => {
  it('lists the rooms the user was in, the same row on both platforms', async () => {
    await openInstances()
    const rows = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('Night Market')
    expect(rows[0]).toContain(msg('instances.hereNow'))
    expect(rows[0]).toContain('VRChat')
    // ChilloutVR's "(#…)" tag is not part of the world's name.
    expect(rows[1]).toContain('Sunset Bay')
    expect(rows[1]).not.toContain('(#42)')
    expect(rows[1]).toContain(msg('instances.duration.hours', { hours: 1, minutes: 30 }))
    expect(rows[1]).toContain('ChilloutVR')
    // No name and no end seen: said plainly, never a made-up length.
    expect(rows[2]).toContain(msg('instances.unknownWorld'))
    expect(rows[2]).toContain(msg('instances.noPeople'))
    expect(document.querySelector('.platform-row--vrchat')).not.toBeNull()
    expect(document.querySelector('.platform-row--chilloutvr')).not.toBeNull()
  })

  it('reads nothing until the tab is opened, and only the filtered platform', async () => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderWith(<ActivityView />)
    expect(getInstanceVisits).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: msg('activity.kinds.instances') }))
    await screen.findByText('Sunset Bay')
    expect(getInstanceVisits).toHaveBeenCalledExactlyOnceWith({
      scope: [{ platform: 'chilloutvr', before: null }]
    })
    expect(screen.queryByText('Night Market')).toBeNull()
  })

  it('opens a row to show who was there', async () => {
    await openInstances()
    const row = screen.getByRole('button', { name: /Night Market/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(getInstanceVisitPeople).toHaveBeenCalledExactlyOnceWith({
      platform: 'vrchat',
      visitId: 3
    })
    const item = row.closest('li')!
    expect(within(item).getByText('Bob')).toBeTruthy()
    expect(item.textContent).toContain(msg('instances.stillHere'))
  })

  it('asks before Clear deletes the instance log, then clears only what is shown', async () => {
    useFriendsStore.setState({ platformFilter: 'vrchat' })
    await openInstances()
    fireEvent.click(screen.getByRole('button', { name: msg('instances.clearAria') }))
    expect(screen.getByText(msg('instances.clearBody'))).toBeTruthy()
    expect(clearInstanceLog).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: msg('activity.clearConfirm.confirm') }))
    await waitFor(() =>
      expect(clearInstanceLog).toHaveBeenCalledExactlyOnceWith({ platforms: ['vrchat'] })
    )
  })

  it('reads again on a change notice and at an account boundary', async () => {
    await openInstances()
    const unsubscribe = subscribeActivity(client)
    const before = getInstanceVisits.mock.calls.length
    boundary?.({ platform: 'vrchat' })
    await waitFor(() => expect(getInstanceVisits.mock.calls.length).toBeGreaterThan(before))
    unsubscribe()
  })

  it('says why nothing is listed while nothing is saved', async () => {
    getInstanceVisits.mockImplementationOnce(() => Promise.resolve({ visits: [], hasMore: false }))
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, activityKeepFor: 'session' } })
    renderWith(<ActivityView />)
    fireEvent.click(screen.getByRole('radio', { name: msg('activity.kinds.instances') }))
    expect(await screen.findByText(msg('instances.sessionHint'))).toBeTruthy()
  })
})

describe('a friend’s History', () => {
  const alice = fullFriend('Alice', 'vrchat')
  const kai = fullFriend('Kai', 'chilloutvr')

  it('shows friends since, time together and earlier names, the same rows per platform', async () => {
    getFriendHistory.mockImplementation(() =>
      Promise.resolve([
        {
          platform: 'vrchat',
          friendId: alice.platformUserId,
          since: now - 400 * 24 * HOUR,
          sinceKnown: true,
          previousNames: [{ name: 'Alys', until: now - 24 * HOUR }],
          met: {
            times: 12,
            togetherMs: 3 * HOUR + 5 * 60_000,
            lastAt: now - 2 * 24 * HOUR,
            lastWorldName: 'Night Market'
          }
        },
        {
          platform: 'chilloutvr',
          friendId: kai.platformUserId,
          since: now - 10 * 24 * HOUR,
          sinceKnown: false,
          previousNames: [],
          met: null
        }
      ])
    )
    renderWith(
      <FriendHistoryDialog accounts={[alice, kai]} name="Alice" onClose={() => undefined} />
    )

    const vrc = await waitFor(() => {
      const block = document.querySelector('[data-history-facts="vrchat"]')
      expect(block).not.toBeNull()
      return block as HTMLElement
    })
    expect(getFriendHistory).toHaveBeenCalledWith({
      friends: [
        { platform: 'vrchat', friendId: alice.platformUserId },
        { platform: 'chilloutvr', friendId: kai.platformUserId }
      ]
    })
    expect(vrc.textContent).toContain(msg('history.sinceLabel'))
    expect(vrc.textContent).toContain(msg('history.lastLabel'))
    expect(vrc.textContent).toContain('Night Market')
    expect(vrc.textContent).toContain(msg('history.timesLabel'))
    expect(vrc.textContent).toContain('12')
    expect(vrc.textContent).toContain(msg('instances.duration.hours', { hours: 3, minutes: 5 }))
    expect(vrc.textContent).toContain('Alys')

    // Already a friend when history began: said as "before", never a made-up day.
    const cvr = document.querySelector('[data-history-facts="chilloutvr"]') as HTMLElement
    expect(cvr.textContent).toContain(
      msg('history.sinceBefore', { date: '' }).split('{{date}}')[0]!.trim().slice(0, 6)
    )
    expect(cvr.textContent).not.toContain(msg('history.timesLabel'))
  })

  it('shows no facts block when nothing is saved about the friend', async () => {
    renderWith(<FriendHistoryDialog accounts={[alice]} name="Alice" onClose={() => undefined} />)
    expect(await screen.findByText(msg('history.emptyHeading'))).toBeTruthy()
    expect(document.querySelector('[data-history-facts]')).toBeNull()
  })
})
