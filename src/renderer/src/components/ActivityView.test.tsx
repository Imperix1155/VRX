// @vitest-environment jsdom
/**
 * Activity page (owner, 2026-10-27): friends coming online, joining worlds and
 * going offline, newest first, with the same row on both platforms.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ActivityEntry } from '@shared/activity'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { activityKey, subscribeActivity } from '../queries/activity'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import { useProfileSelection } from '../stores/profileSelection'
import { fullFriend } from '../test-utils/friendFixture'
import ActivityView from './ActivityView'

const useFriendsMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ value: 'authenticated' }))
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: authState.value, accountId: null, displayName: null },
    isSuccess: true,
    isFetching: false,
    isPending: false
  })
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

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

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
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? [alice] : [kai],
    isPending: false
  }))
  Object.defineProperty(window, 'vrx', {
    configurable: true,
    value: { getActivity: () => Promise.resolve(entries), clearActivity }
  })
})

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  clearActivity.mockClear()
  authState.value = 'authenticated'
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
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
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: msg('activity.clearAria') }).disabled
    ).toBe(true)
    cleanup()

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, activityFilter: 'world' } })
    renderView(entries.filter((entry) => entry.kind !== 'world'))
    expect(screen.getByText(msg('activity.filteredEmpty'))).toBeTruthy()
  })

  it('clears through main and empties the list at once', async () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: msg('activity.clearAria') }))
    expect(clearActivity).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByText(msg('activity.emptyHeading'))).toBeTruthy())
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
