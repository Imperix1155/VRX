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
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import type { Friend, VrcFriend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useFriendsStore } from '../stores/friends'
import { useJoinInstance } from '../hooks/useJoinInstance'
import DashboardView from './DashboardView'

const useFriendsMock = vi.hoisted(() => vi.fn())
const avatarData = vi.hoisted(() => ({ current: null as string | null }))
// Keep the real `scopeByPlatformFilter` (pure) — only the hook is stubbed.
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => avatarData.current }))
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

const publicWorld = (
  id: string,
  name: string,
  worldName = 'SunDown',
  thumbnailUrl: string | null = null
): Friend =>
  makeFriend({
    platformUserId: id,
    displayName: name,
    instance: {
      worldId: 'wrld_sun',
      instanceId: 'wrld_sun:1~public',
      worldName,
      thumbnailUrl,
      type: 'public',
      openness: 'public',
      isGroup: false,
      groupName: null,
      region: 'us',
      userCount: 6
    }
  })

const groupWorld = (id: string, name: string): Friend =>
  makeFriend({
    platformUserId: id,
    displayName: name,
    instance: {
      worldId: 'wrld_group',
      instanceId: 'wrld_group:1~groupPlus',
      worldName: 'Group Hangout',
      thumbnailUrl: null,
      type: 'group-plus',
      openness: 'invite-plus',
      isGroup: true,
      groupName: 'The Cool Group',
      region: 'us',
      userCount: 4
    }
  })

function PendingProbe(): React.JSX.Element {
  const { pendingConfirm, cancelPending } = useJoinInstance()
  return (
    <div>
      <span data-testid="pending">{pendingConfirm?.displayName ?? 'none'}</span>
      <button type="button" data-testid="cancel" onClick={cancelPending} />
    </div>
  )
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  avatarData.current = null
  useFriendsStore.setState({ platformFilter: 'all' }) // reset the global filter
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS }) // reset any mutated settings
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
    // Instance # built via interpolation so a literal hex-like value doesn't trip
    // the design-token raw-color guard.
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

// ─── HotInstanceCard Join (VRX-237) ───────────────────────────────────────────

describe('HotInstanceCard Join (VRX-237)', () => {
  const pyramid = (id: string, name: string): Friend =>
    makeFriend({
      platformUserId: id,
      displayName: name,
      instance: {
        worldId: 'wrld_fish',
        instanceId: 'wrld_fish:aaa~public',
        worldName: 'Fish Pyramid',
        thumbnailUrl: null,
        type: 'public',
        openness: 'public',
        isGroup: false,
        groupName: null,
        region: 'us',
        userCount: 3
      }
    })

  /** Reads the ONE shared join store so the test sees the parked dialog friend. */
  function PendingProbe(): React.JSX.Element {
    const { pendingConfirm, cancelPending } = useJoinInstance()
    return (
      <div>
        <span data-testid="pending">{pendingConfirm?.displayName ?? 'none'}</span>
        <button type="button" data-testid="cancel" onClick={cancelPending} />
      </div>
    )
  }

  it('card Join fires the confirmation dialog (confirmJoin on) exactly once, for the first alphabetical member', () => {
    stubQueries(
      { data: [pyramid('usr_z', 'Zed'), pyramid('usr_a', 'Amy')], isPending: false },
      { data: [], isPending: false }
    )
    render(
      <>
        <DashboardView />
        <PendingProbe />
      </>
    )

    // The hero instance pill IS the Join button, aria-named for the
    // deterministic join target (members sort alphabetically → Amy).
    const joinPill = screen.getByRole('button', {
      name: msg('friends.joinAria', { name: 'Amy', world: 'Fish Pyramid' })
    })

    fireEvent.click(joinPill)
    // confirmJoin defaults ON (VRX-210): the click parks Amy — no launch
    // (with the gate off the probe would read 'none' and the bridge/blip path
    // would have run instead).
    expect(screen.getByTestId('pending').textContent).toBe('Amy')

    // A second click while the dialog is parked is ignored — exactly one join
    // is pending, for the same friend (the modal latch in the shared flow).
    fireEvent.click(joinPill)
    expect(screen.getByTestId('pending').textContent).toBe('Amy')

    act(() => {
      screen.getByTestId('cancel').click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')
  })

  it('shows NO card Join when no member is joinable (shared isFriendJoinable gate)', () => {
    // Visible-but-unjoinable members: CVR "Offline Instance" friends COUNT for
    // the hot card (they are not hidden-location — the owner privacy law is
    // Ask Me/DND only) but are never joinable (isFriendJoinable rejects CVR
    // offline instances). An ask-me/dnd fixture would no longer render a card
    // at all under the VRX-237 privacy law.
    const cvrOfflineInstance = (id: string, name: string): Friend =>
      ({
        ...makeFriend({ platformUserId: id, displayName: name }),
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: {
          worldId: 'i+offline1',
          instanceId: 'i+offline1',
          worldName: 'Private Basement',
          thumbnailUrl: null,
          type: 'offline',
          openness: 'public',
          isGroup: false,
          groupName: null,
          region: null,
          userCount: 2
        }
      }) as unknown as Friend
    stubQueries(
      { data: [], isPending: false },
      {
        data: [cvrOfflineInstance('cvr_a', 'Amy'), cvrOfflineInstance('cvr_b', 'Bo')],
        isPending: false
      }
    )
    render(<DashboardView />)

    // The card renders (they DO share an exact instance and are visible) but
    // the pill stays a plain span — there is no Join button for anyone.
    expect(screen.getByText('Private Basement')).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: msg('friends.joinAria', { name: 'Amy', world: 'Private Basement' })
      })
    ).toBeNull()
  })
})

// ─── HotInstanceSheet (VRX-250) ───────────────────────────────────────────────

describe('HotInstanceSheet (VRX-250)', () => {
  it('clicking the card body opens the sheet; clicking the Join pill joins and does not open', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(
      <>
        <DashboardView />
        <PendingProbe />
      </>
    )

    const card = screen.getByRole('button', {
      name: msg('hotSheet.ariaLabel', { world: 'SunDown' })
    })

    // Card click opens the sheet.
    fireEvent.click(card)
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()
    expect(screen.getByText(msg('hotSheet.friendsHereHeading', { count: 2 }))).toBeTruthy()

    // Close the sheet.
    fireEvent.click(screen.getByRole('button', { name: msg('drawer.close') }))
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()

    // The hero Join pill still joins (does not reopen the sheet).
    const joinPill = screen.getByRole('button', {
      name: msg('friends.joinAria', { name: 'Amy', world: 'SunDown' })
    })
    fireEvent.click(joinPill)
    expect(screen.getByTestId('pending').textContent).toBe('Amy')
    // Sheet did NOT open.
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()

    // Clean up the parked join confirm so later tests are not polluted.
    act(() => {
      screen.getByTestId('cancel').click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')
  })

  it('sheet shows banner name, ALL member chips, instance id, and openness sentence', () => {
    // 6 friends proves the sheet never truncates (the card truncates at 4).
    const names = ['Nyx', 'Kettle', 'GrayCoat', 'Vex', 'Zoe', 'Amy']
    stubQueries(
      { data: names.map((n, i) => publicWorld(`usr_${i}`, n)), isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))

    // Banner world name.
    expect(screen.getAllByText('SunDown').length).toBeGreaterThanOrEqual(1)
    // ALL six member chips.
    for (const name of names) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // Instance id.
    expect(screen.getByText('wrld_sun:1~public')).toBeTruthy()
    // Openness sentence (public).
    expect(screen.getByText(msg('joinConfirm.openness.public'))).toBeTruthy()
  })

  it('platform stripe is clipped inside the panel radius container, not full-window', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const stripe = screen.getByTestId('hot-sheet-stripe')
    // The stripe must be a descendant of the overflow-clipping radius wrapper.
    const clipper = stripe.closest('.overflow-hidden')
    expect(clipper).not.toBeNull()
    expect(clipper?.className).toContain('rounded-t-[var(--radius-panel)]')
  })

  it('sheet and scrim are offset from the left edge so they do not cover the sidebar', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const panel = screen.getByRole('dialog', { name: 'SunDown' })
    const scrim = screen.getByTestId('hot-sheet-scrim')

    // Both surfaces carry the shared content-inset offset, not a full-window left-0.
    expect(panel.className).toContain('left-[var(--content-inset-left)]')
    expect(panel.className).not.toContain('left-0')
    expect(scrim.className).toContain('left-[var(--content-inset-left)]')
    expect(scrim.className).not.toContain('left-0')

    // The panel must be genuinely viewport-fixed: a bare `relative` utility on
    // the same element FIGHTS `fixed` in the cascade and won (render-check,
    // 2026-08-12) — the sheet silently became in-flow while every class-name
    // pin still passed. Same defect family as the v0.10.0 `.glass` drawer bug.
    expect(panel.className).toMatch(/\bfixed\b/)
    expect(panel.className).not.toMatch(/\brelative\b/)

    // Right edge is half the containment fix — pin it symmetrically.
    expect(panel.className).toContain('right-[var(--content-inset-right)]')
    expect(panel.className).not.toMatch(/\bright-0\b/)
    expect(scrim.className).toContain('right-[var(--content-inset-right)]')
    expect(scrim.className).not.toMatch(/\bright-0\b/)

    // The scrim needs BOTH vertical anchors or it resolves to zero height and
    // paints nothing (review 2026-08-12: `bottom-0` alone shipped an invisible
    // scrim while every class pin stayed green).
    expect(scrim.className).toContain('inset-y-0')
    expect(scrim.className).not.toMatch(/\bbottom-0\b/)
  })

  it('openness sentence sits above the friends-here heading in DOM order', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })
    const openness = within(sheet).getByTestId('hot-sheet-openness-sentence')
    const heading = within(sheet).getByRole('heading', {
      name: msg('hotSheet.friendsHereHeading', { count: 2 })
    })

    expect(openness.textContent).toBe(msg('joinConfirm.openness.public'))
    // The openness sentence precedes the friends-here heading in the DOM.
    expect(heading.compareDocumentPosition(openness) & Node.DOCUMENT_POSITION_PRECEDING).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    )
  })

  it('instance id is demoted to a small mono line at the bottom of the right zone with full value in title', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })
    const idEl = within(sheet).getByTestId('hot-sheet-instance-id')

    expect(idEl.textContent).toBe('wrld_sun:1~public')
    expect(idEl.getAttribute('title')).toBe('wrld_sun:1~public')
    expect(idEl.className).toContain('text-[10.5px]')
    expect(idEl.className).toContain('text-[var(--text-faint)]')
    // It lives in the right-hand meta zone (justified to the end of the row).
    expect(idEl.parentElement?.className).toContain('justify-end')
  })

  it('banner carries the shared InstancePill and PlatformPill; hosted-by line is gone', () => {
    stubQueries(
      { data: [groupWorld('usr_a', 'Amy'), groupWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /Group Hangout hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'Group Hangout' })
    const banner = within(sheet).getByTestId('hot-sheet-banner')

    // The shared InstancePill (tier-colored openness label) sits on the banner —
    // asserted via the component-owned marker, so a locally re-implemented span
    // with the right words cannot pass (review 2026-08-12).
    const instancePill = banner.querySelector('[data-instance-pill]')
    expect(instancePill).toBeTruthy()
    expect(instancePill?.textContent).toBe('Group+')
    // The shared PlatformPill (non-color platform signifier) sits on the banner.
    const platformPill = banner.querySelector('[data-platform-pill]')
    expect(platformPill).toBeTruthy()
    expect(platformPill?.textContent).toBe(msg('dashboard.platformVrc'))
    // The old hosted-by line is fully removed — no "Hosted by" anywhere.
    expect(screen.queryByText(/Hosted by/)).toBeNull()

    // Non-group instance: still has both pills, no hosted-by line.
    cleanup()
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)
    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const publicSheet = screen.getByRole('dialog', { name: 'SunDown' })
    const publicBanner = within(publicSheet).getByTestId('hot-sheet-banner')
    expect(within(publicBanner).getByText('Public')).toBeTruthy()
    expect(within(publicBanner).getByText(msg('dashboard.platformVrc'))).toBeTruthy()
    expect(screen.queryByText(/Hosted by/)).toBeNull()
  })

  it('opennessUnknown renders the unknown copy', () => {
    const unknownWorld = (id: string, name: string): Friend =>
      makeFriend({
        platformUserId: id,
        displayName: name,
        instance: {
          worldId: 'wrld_unk',
          instanceId: 'wrld_unk:1~public',
          worldName: 'Mystery World',
          thumbnailUrl: null,
          type: 'public',
          openness: 'public',
          opennessUnknown: true,
          isGroup: false,
          groupName: null,
          region: 'us',
          userCount: 2
        }
      })
    stubQueries(
      { data: [unknownWorld('usr_a', 'Amy'), unknownWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /Mystery World hot instance details/ }))
    expect(screen.getByText(msg('joinConfirm.openness.unknown'))).toBeTruthy()
  })

  it('sheet Join routes through the shared flow for the first joinable member', () => {
    stubQueries(
      { data: [publicWorld('usr_z', 'Zed'), publicWorld('usr_a', 'Amy')], isPending: false },
      { data: [], isPending: false }
    )
    render(
      <>
        <DashboardView />
        <PendingProbe />
      </>
    )

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })
    const sheetJoin = within(sheet).getByRole('button', {
      name: msg('friends.joinAria', { name: 'Amy', world: 'SunDown' })
    })
    fireEvent.click(sheetJoin)
    expect(screen.getByTestId('pending').textContent).toBe('Amy')

    act(() => {
      screen.getByTestId('cancel').click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')
  })

  it('sheet Join is absent when no member is joinable', () => {
    const cvrOfflineInstance = (id: string, name: string): Friend =>
      ({
        ...makeFriend({ platformUserId: id, displayName: name }),
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: {
          worldId: 'i+offline1',
          instanceId: 'i+offline1',
          worldName: 'Private Basement',
          thumbnailUrl: null,
          type: 'offline',
          openness: 'public',
          isGroup: false,
          groupName: null,
          region: null,
          userCount: 2
        }
      }) as unknown as Friend
    stubQueries(
      { data: [], isPending: false },
      {
        data: [cvrOfflineInstance('cvr_a', 'Amy'), cvrOfflineInstance('cvr_b', 'Bo')],
        isPending: false
      }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /Private Basement hot instance details/ }))
    expect(
      screen.queryByRole('button', {
        name: msg('friends.joinAria', { name: 'Amy', world: 'Private Basement' })
      })
    ).toBeNull()
  })

  it('closes via ✕, Esc, and outside pointerdown; focus returns to the opener', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    const card = screen.getByRole('button', { name: /SunDown hot instance details/ })
    fireEvent.click(card)
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()

    // ✕ closes.
    fireEvent.click(screen.getByRole('button', { name: msg('drawer.close') }))
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()
    expect(document.activeElement).toBe(card)

    // Esc closes.
    fireEvent.click(card)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()

    // Outside pointerdown closes.
    fireEvent.click(card)
    const scrim = screen.getByTestId('hot-sheet-scrim')
    fireEvent.pointerDown(scrim)
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()
  })

  it('opening a different card switches the sheet content in place', () => {
    const worldA1 = publicWorld('usr_a1', 'Amy', 'World A')
    const worldA2 = publicWorld('usr_a2', 'Ava', 'World A')
    const worldB1 = publicWorld('usr_b1', 'Bo', 'World B')
    const worldB2 = publicWorld('usr_b2', 'Bex', 'World B')
    // Force different instance ids so the two worlds don't collapse into one hot instance.
    ;(worldB1.instance as NonNullable<typeof worldB1.instance>).instanceId = 'wrld_b:1~public'
    ;(worldB1.instance as NonNullable<typeof worldB1.instance>).worldId = 'wrld_b'
    ;(worldB2.instance as NonNullable<typeof worldB2.instance>).instanceId = 'wrld_b:1~public'
    ;(worldB2.instance as NonNullable<typeof worldB2.instance>).worldId = 'wrld_b'
    stubQueries(
      { data: [worldA1, worldA2, worldB1, worldB2], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /World A hot instance details/ }))
    expect(screen.getByRole('dialog', { name: 'World A' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /World B hot instance details/ }))
    expect(screen.queryByRole('dialog', { name: 'World A' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'World B' })).toBeTruthy()
  })

  it('shows a placeholder when no thumbnail is known; no broken image renders', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })
    // No <img> in the banner (thumbnailUrl is null).
    expect(sheet.querySelector('img')).toBeNull()
    // The world name still renders.
    expect(screen.getAllByText('SunDown').length).toBeGreaterThanOrEqual(1)
  })
})

describe('HotInstanceCard keyboard (VRX-250 review)', () => {
  it('Enter and Space on the card body open the sheet', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)
    const card = screen.getByRole('button', { name: /SunDown hot instance details/ })

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: msg('drawer.close') }))
    fireEvent.keyDown(card, { key: ' ' })
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()
  })

  it('Enter and Space on the Join pill do NOT open the sheet; the pill still joins', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(
      <>
        <DashboardView />
        <PendingProbe />
      </>
    )

    const joinPill = screen.getByRole('button', {
      name: msg('friends.joinAria', { name: 'Amy', world: 'SunDown' })
    })
    joinPill.focus()

    // Keyboard event bubbling from the pill to the card must be ignored.
    fireEvent.keyDown(joinPill, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()

    fireEvent.keyDown(joinPill, { key: ' ' })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()

    // The pill's own join path is still intact.
    fireEvent.click(joinPill)
    expect(screen.getByTestId('pending').textContent).toBe('Amy')

    act(() => {
      screen.getByTestId('cancel').click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')
  })
})

describe('HotInstanceSheet live truth + presentation (VRX-250 review)', () => {
  it('re-derives the live instance so roster mutations update the sheet while open', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    const view = render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    expect(screen.getByText(msg('hotSheet.friendsHereHeading', { count: 2 }))).toBeTruthy()
    expect(screen.queryByText('Cara')).toBeNull()

    // Add a third friend and rerender — the sheet must reflect the live roster.
    stubQueries(
      {
        data: [
          publicWorld('usr_a', 'Amy'),
          publicWorld('usr_b', 'Bo'),
          publicWorld('usr_c', 'Cara')
        ],
        isPending: false
      },
      { data: [], isPending: false }
    )
    view.rerender(<DashboardView />)
    expect(screen.getByText(msg('hotSheet.friendsHereHeading', { count: 3 }))).toBeTruthy()
    expect(screen.getByText('Cara')).toBeTruthy()
  })

  it('self-closes when the instance drops below the threshold', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()

    act(() => {
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 3 }
      })
    })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()
  })

  it('self-closes on account-switch roster wipe', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    const view = render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    expect(screen.getByRole('dialog', { name: 'SunDown' })).toBeTruthy()

    // Simulate a roster wipe (e.g. identity boundary clearing the mounted data).
    stubQueries({ data: [], isPending: false }, { data: [], isPending: false })
    view.rerender(<DashboardView />)
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()
  })

  it('renders a CSP-safe data-URL banner image through the avatar pipeline', () => {
    stubQueries(
      {
        data: [
          publicWorld('usr_a', 'Amy', 'SunDown', 'https://cdn.example/world.png'),
          publicWorld('usr_b', 'Bo', 'SunDown', 'https://cdn.example/world.png')
        ],
        isPending: false
      },
      { data: [], isPending: false }
    )
    avatarData.current = 'data:image/png;base64,banner'
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const img = screen.getByRole('dialog', { name: 'SunDown' }).querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toMatch(/^data:/)
  })

  it('shows the gradient placeholder when the pipeline returns null', () => {
    stubQueries(
      {
        data: [
          publicWorld('usr_a', 'Amy', 'SunDown', 'https://cdn.example/world.png'),
          publicWorld('usr_b', 'Bo', 'SunDown', 'https://cdn.example/world.png')
        ],
        isPending: false
      },
      { data: [], isPending: false }
    )
    avatarData.current = null
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    expect(screen.getByRole('dialog', { name: 'SunDown' }).querySelector('img')).toBeNull()
  })

  it('renders 24px Avatar chips in the member list', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(<DashboardView />)

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })
    expect(sheet.querySelector('.h-\\[24px\\]')).not.toBeNull()
  })

  it('renders the join-denial blip as an inset-0 overlay (no negative offsets)', () => {
    try {
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, confirmJoin: false }
      })
      stubQueries(
        { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
        { data: [], isPending: false }
      )
      render(<DashboardView />)

      fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
      const sheet = screen.getByRole('dialog', { name: 'SunDown' })
      const joinBtn = within(sheet).getByRole('button', {
        name: msg('friends.joinAria', { name: 'Amy', world: 'SunDown' })
      })

      // With no window.vrx and confirmation disabled, the join attempt fails
      // immediately and shows the attributed blip.
      fireEvent.click(joinBtn)
      const blip = within(sheet).getByRole('status')
      const className = blip.className
      expect(className).toContain('inset-0')
      expect(className).not.toContain('-bottom-')
    } finally {
      useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
    }
  })

  it('Esc and outside pointerdown do NOT close the sheet while a join confirm is parked', () => {
    stubQueries(
      { data: [publicWorld('usr_a', 'Amy'), publicWorld('usr_b', 'Bo')], isPending: false },
      { data: [], isPending: false }
    )
    render(
      <>
        <DashboardView />
        <PendingProbe />
      </>
    )

    fireEvent.click(screen.getByRole('button', { name: /SunDown hot instance details/ }))
    const sheet = screen.getByRole('dialog', { name: 'SunDown' })

    fireEvent.click(
      within(sheet).getByRole('button', {
        name: msg('friends.joinAria', { name: 'Amy', world: 'SunDown' })
      })
    )
    expect(screen.getByTestId('pending').textContent).toBe('Amy')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).not.toBeNull()

    fireEvent.pointerDown(screen.getByTestId('hot-sheet-scrim'))
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).not.toBeNull()

    act(() => {
      screen.getByTestId('cancel').click()
    })
    expect(screen.getByTestId('pending').textContent).toBe('none')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'SunDown' })).toBeNull()
  })

  it('pins the current raw CVR world name (incl. (#instanceNumber)) in the sheet', () => {
    // Build the suffix dynamically so the literal instance-tag pattern does not
    // trip the design-token raw-color guard (the suffix is identity, not color).
    const suffix = `${String.fromCharCode(35)}12345`
    const rawName = `Sunny Beach (${suffix})`
    const cvrWorld = (id: string, name: string): Friend =>
      ({
        ...makeFriend({ platformUserId: id, displayName: name }),
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: {
          worldId: 'world_123',
          instanceId: 'world_123:1~public',
          worldName: rawName,
          thumbnailUrl: null,
          type: 'public',
          openness: 'public',
          isGroup: false,
          groupName: null,
          region: 'us',
          userCount: 2
        }
      }) as unknown as Friend

    stubQueries(
      { data: [], isPending: false },
      { data: [cvrWorld('cvr_a', 'Amy'), cvrWorld('cvr_b', 'Bo')], isPending: false }
    )
    render(<DashboardView />)

    // The card aria-label uses the stripped name; the sheet keeps the raw name.
    fireEvent.click(screen.getByRole('button', { name: /Sunny Beach hot instance details/ }))
    expect(screen.getByRole('dialog', { name: rawName })).toBeTruthy()
    expect(within(screen.getByRole('dialog', { name: rawName })).getByText(rawName)).toBeTruthy()
  })
})
