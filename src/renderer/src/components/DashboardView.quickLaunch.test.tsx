// @vitest-environment jsdom
/**
 * Where the Dashboard puts Quick launch (owner, 2026-11-18): right under the
 * numbers by default, wherever the section order moves it, inside the platform
 * filter, and in the loading and error states too, because starting a game
 * needs no friends list. The row itself: DashboardQuickLaunch.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { translate as msg } from '../i18n/translate'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import DashboardView from './DashboardView'

type QueryStub = { data: Friend[] | undefined; isPending: boolean; isError?: boolean }
const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
// A marker for where the glance row mounts; it has its own tests.
vi.mock('./DashboardGlance', () => ({
  default: () => <div data-testid="dashboard-glance" />
}))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: { platform, state: 'authenticated', accountId: `${platform}-test`, displayName: 'Me' }
  })
}))

const loaded: QueryStub = { data: [], isPending: false }
function stubQueries(vrc: QueryStub = loaded, cvr: QueryStub = loaded): void {
  useFriendsMock.mockImplementation((platform: string) => (platform === 'vrchat' ? vrc : cvr))
}

const launchLabel = (platform: 'Vrc' | 'Cvr'): string =>
  msg('dashboard.quickLaunch.launch', { platform: msg(`dashboard.platform${platform}`) })
const launchRow = (): HTMLElement =>
  screen.getByRole('region', { name: msg('dashboard.quickLaunch.heading') })
const buttonNames = (): (string | null)[] =>
  within(launchRow())
    .getAllByRole('button')
    .map((button) => button.textContent)
const follows = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('Dashboard Quick launch placement', () => {
  it('sits right under the numbers by default, VRChat then ChilloutVR', () => {
    stubQueries()
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<DashboardView />)
    expect(buttonNames()).toEqual([launchLabel('Vrc'), launchLabel('Cvr')])
    expect(follows(screen.getByText(msg('dashboard.statOnlineLabel')), launchRow())).toBe(true)
    expect(follows(launchRow(), screen.getByTestId('dashboard-glance'))).toBe(true)
  })

  it('goes wherever the section order puts it', () => {
    stubQueries()
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        dashboardSections: ['wearing-now', 'invites', 'quick-launch', 'popular', 'hot']
      }
    })
    render(<DashboardView />)
    expect(follows(screen.getByTestId('dashboard-glance'), launchRow())).toBe(true)
  })

  it('follows the platform filter and hides with its switch', () => {
    stubQueries()
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    const filtered = render(<DashboardView />)
    expect(buttonNames()).toEqual([launchLabel('Cvr')])
    filtered.unmount()

    useFriendsStore.setState({ platformFilter: 'all' })
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardQuickLaunch: false } })
    render(<DashboardView />)
    expect(screen.queryByRole('region', { name: msg('dashboard.quickLaunch.heading') })).toBeNull()
  })

  it('stays while friends load and when they cannot be loaded', () => {
    const pending: QueryStub = { data: undefined, isPending: true }
    stubQueries(pending, pending)
    const loading = render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
    expect(buttonNames()).toEqual([launchLabel('Vrc'), launchLabel('Cvr')])
    loading.unmount()

    const failed: QueryStub = { data: undefined, isPending: false, isError: true }
    stubQueries(failed, failed)
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.error'))).toBeTruthy()
    expect(buttonNames()).toEqual([launchLabel('Vrc'), launchLabel('Cvr')])
  })
})
