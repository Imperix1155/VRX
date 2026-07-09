// @vitest-environment jsdom
/**
 * DashboardView state tests (audit W5).
 *
 * Pins the load/error contract added in W5: with no cached data an outage must
 * show an explicit error — never the misleading "0 / 0 / 0" stat cards — and an
 * in-flight initial load must show "loading". Partial data (one platform up)
 * renders normally.
 *
 * The queries module is mocked at the hook seam (per the render-check recipe):
 * DashboardView consumes only { data, isPending } from useFriends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import type { Friend, VrcFriend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import DashboardView from './DashboardView'

const useFriendsMock = vi.hoisted(() => vi.fn())
// Keep the real `scopeByPlatformFilter` (pure) — only the hook is stubbed.
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))

// Assertions go through i18n.t so a copy tweak doesn't break behavior tests.
const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

type QueryStub = {
  data: Friend[] | undefined
  isPending: boolean
  refetch?: ReturnType<typeof vi.fn>
}

function stubQueries(vrc: QueryStub, cvr: QueryStub): void {
  useFriendsMock.mockImplementation((platform: string) => (platform === 'vrchat' ? vrc : cvr))
}

function makeFriend(overrides: Partial<VrcFriend> = {}): Friend {
  const base: VrcFriend = {
    platform: 'vrchat',
    platformUserId: 'usr_1',
    displayName: 'Alice',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    trustRank: 'known',
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  return { ...base, ...overrides }
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  useFriendsStore.setState({ platformFilter: 'all' }) // reset the global filter
})

describe('DashboardView states (W5)', () => {
  it('shows loading (not 0/0/0) while both queries are pending with no data', () => {
    stubQueries({ data: undefined, isPending: true }, { data: undefined, isPending: true })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
    expect(screen.queryByText(msg('dashboard.statOnlineLabel'))).toBeNull() // no stat cards
  })

  it('keeps showing loading while one platform is still pending and none has data', () => {
    stubQueries({ data: undefined, isPending: false }, { data: undefined, isPending: true })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
  })

  it('shows an error (not "no friends online") when everything failed with no data', () => {
    stubQueries({ data: undefined, isPending: false }, { data: undefined, isPending: false })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.error'))).toBeTruthy()
    expect(screen.queryByText(msg('dashboard.emptyHeading'))).toBeNull()
  })

  it('offers a retry in the error state that refetches both platforms', () => {
    const vrcRefetch = vi.fn()
    const cvrRefetch = vi.fn()
    stubQueries(
      { data: undefined, isPending: false, refetch: vrcRefetch },
      { data: undefined, isPending: false, refetch: cvrRefetch }
    )
    render(<DashboardView />)
    fireEvent.click(screen.getByRole('button', { name: msg('dashboard.retry') }))
    expect(vrcRefetch).toHaveBeenCalledTimes(1)
    expect(cvrRefetch).toHaveBeenCalledTimes(1)
  })

  it('scopes the stats to the selected platform filter (VRX-66)', () => {
    const vrcOnline = (id: string): Friend =>
      makeFriend({ platformUserId: id, presence: { state: 'active' } })
    const cvrOnline = {
      ...makeFriend(),
      platform: 'chilloutvr',
      platformUserId: 'cvr_1',
      presence: { state: 'active' },
      status: null,
      statusDescription: null
    } as unknown as Friend
    stubQueries(
      { data: [vrcOnline('v1'), vrcOnline('v2'), vrcOnline('v3')], isPending: false },
      { data: [cvrOnline], isPending: false }
    )
    act(() => {
      useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    })
    render(<DashboardView />)
    // Only the single ChilloutVR friend counts online — the 3 VRChat friends are
    // filtered out (an unscoped dashboard would show 4).
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.queryByText('4')).toBeNull()
  })

  it('renders stats from partial data when one platform errored', () => {
    stubQueries(
      { data: [makeFriend()], isPending: false },
      { data: undefined, isPending: false } // CVR failed — VRC data still renders
    )
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.statOnlineLabel'))).toBeTruthy()
    // onlineCount and inGameCount both = 1 (the single in-game friend)
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2)
  })

  it('labels the hot-instances section with its heading (landmark, W5)', () => {
    stubQueries({ data: [makeFriend()], isPending: false }, { data: [], isPending: false })
    render(<DashboardView />)
    const heading = screen.getByRole('heading', { name: msg('dashboard.sectionHotInstances') })
    expect(heading.id).toBe('dashboard-hot-heading')
  })

  it('hot-card openness label follows the labelScheme setting (VRX-183)', () => {
    // jsdom renders client-side, so the REAL settings store applies (unlike the
    // SSR-rendered FriendsList tests, which must mock it — see that file).
    const hotGroupPlus = (id: string): Friend =>
      makeFriend({
        platformUserId: id,
        instance: {
          worldId: 'wrld_hot',
          instanceId: 'wrld_hot:1~groupPlus',
          worldName: 'Midnight Rooftop',
          thumbnailUrl: null,
          type: 'group-plus',
          openness: 'invite-plus',
          isGroup: true,
          groupName: null,
          region: 'us',
          userCount: 5
        }
      })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, labelScheme: 'chilloutvr' }
    })
    try {
      stubQueries(
        { data: [hotGroupPlus('usr_1'), hotGroupPlus('usr_2')], isPending: false },
        { data: [], isPending: false }
      )
      render(<DashboardView />)
      expect(screen.getByText('Friends of Members')).toBeTruthy()
      expect(screen.queryByText('Group+')).toBeNull()
    } finally {
      useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
    }
  })

  it('hot card shows the stripped world name, first-4 names + overflow, and the platform pill (VRX-198)', () => {
    // Instance # built via interpolation so a literal "#816332" doesn't trip the
    // design-token raw-color guard.
    const hotWorldName = `SunDown (#${816332})`
    const inWorld = (id: string, name: string): Friend =>
      makeFriend({
        platformUserId: id,
        displayName: name,
        instance: {
          worldId: 'wrld_sun',
          instanceId: 'wrld_sun:1~public',
          worldName: hotWorldName,
          thumbnailUrl: null,
          type: 'public',
          openness: 'public',
          isGroup: false,
          groupName: null,
          region: 'us',
          userCount: 6
        }
      })
    // 6 friends → sorted alphabetically: Amy, GrayCoat, Kettle, Nyx, Vex, Zoe.
    const names = ['Nyx', 'Kettle', 'GrayCoat', 'Vex', 'Zoe', 'Amy']
    stubQueries(
      { data: names.map((n, i) => inWorld(`usr_${i}`, n)), isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    // World name shows WITHOUT the CVR (#instanceNumber) suffix.
    expect(screen.getByText('SunDown')).toBeTruthy()
    expect(screen.queryByText(hotWorldName)).toBeNull()
    // First four names (alphabetical), then "+2".
    expect(screen.getByText(/Amy, GrayCoat, Kettle, Nyx/)).toBeTruthy()
    expect(screen.getByText(msg('dashboard.friendsOverflow', { count: 2 }))).toBeTruthy()
    // The quiet platform pill carries the full platform name (a11y label).
    expect(screen.getByText(msg('dashboard.platformVrc'))).toBeTruthy()
  })

  it('hot grid follows the hotInstanceThreshold setting immediately (VRX-78)', () => {
    const solo = makeFriend({
      platformUserId: 'usr_solo',
      instance: {
        worldId: 'wrld_quiet',
        instanceId: 'wrld_quiet:1~public',
        worldName: 'Quiet World',
        thumbnailUrl: null,
        type: 'public',
        openness: 'public',
        isGroup: false,
        groupName: null,
        region: 'us',
        userCount: 1
      }
    })
    stubQueries({ data: [solo], isPending: false }, { data: [], isPending: false })

    try {
      // Default threshold (2): a single friend in a world is NOT hot → empty state.
      render(<DashboardView />)
      expect(screen.getByText(msg('dashboard.emptyHeading'))).toBeTruthy()

      // Mutate the store while MOUNTED — the same render must react live
      // (no unmount/remount; this is the "immediate, no restart" AC itself).
      act(() =>
        useSettingsStore.setState({
          settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 1 }
        })
      )
      expect(screen.getByText('Quiet World')).toBeTruthy()
      expect(screen.queryByText(msg('dashboard.emptyHeading'))).toBeNull()
      // The quick-access stepper reflects the live value.
      const spin = screen.getByRole('spinbutton', { name: msg('dashboard.hotThresholdAria') })
      expect(spin.getAttribute('aria-valuenow')).toBe('1')
    } finally {
      useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
    }
  })
})
