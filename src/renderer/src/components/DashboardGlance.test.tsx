// @vitest-environment jsdom
/**
 * Dashboard glance row (owner, 2026-10-27): the worn avatar and the latest
 * invite per platform. Both platforms get the same rows; the worn avatar costs
 * at most one request per platform and none when the Avatars page already
 * knows it; invites come from the in-memory inbox only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AvatarItem, AvatarLibraryResult, CurrentAvatarResult } from '@shared/avatarLibrary'
import type { InboxItem } from '@shared/inbox'
import type { AuthStatus, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { avatarLibraryQueryKey } from '../queries/avatarLibrary'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import type { GlanceSection } from '../utils/dashboardAggregations'
import DashboardGlance from './DashboardGlance'

vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: () => ({ data: [] })
}))
const authState = vi.hoisted(() => ({ vrchat: 'authenticated', chilloutvr: 'authenticated' }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: Platform) => {
    const state = authState[platform]
    const data: AuthStatus =
      state === 'authenticated'
        ? { platform, state, accountId: `${platform}-me`, displayName: 'Me' }
        : { platform, state: 'unauthenticated', accountId: null, displayName: null }
    return { data, isSuccess: true, isFetching: false, isPending: false }
  }
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)
const platformName = (platform: Platform): string =>
  msg(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')

function avatar(platform: Platform, index: number, name: string): AvatarItem {
  const guid = `5a3c1e2d-0000-4000-8000-${String(index).padStart(12, '0')}`
  return {
    platform,
    avatarId: platform === 'vrchat' ? `avtr_${guid}` : guid,
    name,
    description: null,
    imageUrl: null,
    authorName: 'Me',
    visibility: null,
    createdAt: null,
    updatedAt: null
  }
}

const vrcWorn = avatar('vrchat', 1, 'Lumen Fox')
const cvrWorn = avatar('chilloutvr', 2, 'Ember Synth')
const NOW = Date.now()

function invite(
  platform: Platform,
  id: string,
  sender: string,
  minutesAgo: number,
  kind: InboxItem['kind'] = 'invite'
): InboxItem {
  return {
    id,
    platform,
    kind,
    senderId: `${platform}-${id}`,
    senderName: sender,
    worldName: kind === 'invite' ? 'Moonlit Observatory' : null,
    receivedAt: NOW - minutesAgo * 60_000
  }
}

let inboxItems: InboxItem[] = []
const bridge = {
  getCurrentAvatar: vi.fn(({ platform }: { platform: Platform }): Promise<CurrentAvatarResult> =>
    Promise.resolve({ ok: true, platform, current: platform === 'vrchat' ? vrcWorn : cvrWorn })
  ),
  getAvatarLibrary: vi.fn(),
  getInbox: vi.fn(() => Promise.resolve({ items: inboxItems }))
}

let client: QueryClient
function renderGlance(
  platforms: Platform[] = ['vrchat', 'chilloutvr'],
  sections?: GlanceSection[]
): void {
  render(
    <QueryClientProvider client={client}>
      <DashboardGlance platforms={platforms} sections={sections} />
    </QueryClientProvider>
  )
}

const wornFor = ({ platform }: { platform: Platform }): Promise<CurrentAvatarResult> =>
  Promise.resolve({ ok: true, platform, current: platform === 'vrchat' ? vrcWorn : cvrWorn })

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  inboxItems = []
  bridge.getCurrentAvatar.mockImplementation(wornFor)
  Object.defineProperty(window, 'vrx', { value: bridge, configurable: true, writable: true })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  useUiStore.setState({ activeTab: 'dashboard' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  authState.vrchat = 'authenticated'
  authState.chilloutvr = 'authenticated'
  Reflect.deleteProperty(window, 'vrx')
})

const wornRow = (item: AvatarItem): Promise<HTMLElement> =>
  screen.findByRole('button', {
    name: msg('dashboard.glance.wornAria', {
      name: item.name,
      platform: platformName(item.platform)
    })
  })

describe('DashboardGlance: Wearing now', () => {
  it('shows each worn avatar with one worn-only read per platform, never the library', async () => {
    renderGlance()
    const vrc = await wornRow(vrcWorn)
    const cvr = await wornRow(cvrWorn)
    expect(within(vrc).getByText(platformName('vrchat'))).toBeTruthy()
    expect(within(cvr).getByText(platformName('chilloutvr'))).toBeTruthy()
    expect(bridge.getCurrentAvatar).toHaveBeenCalledTimes(2)
    expect(bridge.getAvatarLibrary).not.toHaveBeenCalled()

    fireEvent.click(cvr)
    expect(useUiStore.getState().activeTab).toBe('avatars')
  })

  it('uses a fresh Avatars page read without asking main', async () => {
    const lib: AvatarLibraryResult = {
      ok: true,
      platform: 'vrchat',
      avatars: [vrcWorn],
      complete: true,
      current: vrcWorn
    }
    client.setQueryData(avatarLibraryQueryKey('vrchat', 'vrchat-me'), lib)
    renderGlance(['vrchat'])
    await wornRow(vrcWorn)
    expect(bridge.getCurrentAvatar).not.toHaveBeenCalled()
  })

  it('follows a newer Avatars page answer, such as a Wear press', async () => {
    renderGlance(['vrchat'])
    await wornRow(vrcWorn)
    const other = avatar('vrchat', 9, 'Night Runner')
    const switched: AvatarLibraryResult = {
      ok: true,
      platform: 'vrchat',
      avatars: [vrcWorn, other],
      complete: true,
      current: other
    }
    act(() => {
      client.setQueryData(avatarLibraryQueryKey('vrchat', 'vrchat-me'), switched)
    })
    await wornRow(other)
  })

  it('skips a signed-out platform entirely', async () => {
    authState.chilloutvr = 'unauthenticated'
    renderGlance()
    await wornRow(vrcWorn)
    expect(screen.queryByText(platformName('chilloutvr'))).toBeNull()
    expect(bridge.getCurrentAvatar).toHaveBeenCalledTimes(1)
    expect(bridge.getCurrentAvatar).toHaveBeenCalledWith({ platform: 'vrchat' })
  })

  it('says when the platform did not report one, and offers Try again on a failure', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardHideEmpty: false } })
    bridge.getCurrentAvatar.mockImplementation(({ platform }) =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: true, platform, current: null }
          : { ok: false, reason: 'rate-limited' }
      )
    )
    renderGlance()
    expect(await screen.findByText(msg('avatars.noCurrent.vrchat'))).toBeTruthy()
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain(
      msg('avatars.error.rate-limited', { platform: platformName('chilloutvr') })
    )
    bridge.getCurrentAvatar.mockImplementation(({ platform }) =>
      Promise.resolve({ ok: true, platform, current: cvrWorn })
    )
    fireEvent.click(within(failure).getByRole('button', { name: msg('avatars.retry') }))
    await wornRow(cvrWorn)
  })
})

describe('DashboardGlance: Latest invites', () => {
  it('shows the newest invite per platform, skips friend requests, and links to the Inbox', async () => {
    inboxItems = [
      invite('chilloutvr', 'c-new', 'Nyx', 3, 'invite-request'),
      invite('vrchat', 'v-friend', 'Friendly', 1, 'friend-request'),
      invite('vrchat', 'v-new', 'Aria', 5),
      invite('vrchat', 'v-old', 'Old Timer', 50),
      invite('chilloutvr', 'c-old', 'Older', 90)
    ]
    renderGlance()
    const region = await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    await within(region).findByText('Aria')
    expect(within(region).getByText('Nyx')).toBeTruthy()
    expect(within(region).queryByText('Old Timer')).toBeNull()
    expect(within(region).queryByText('Older')).toBeNull()
    expect(within(region).queryByText('Friendly')).toBeNull()
    // VRChat's row comes first, each with its platform as a word.
    const rows = within(region).getAllByRole('listitem')
    expect(within(rows[0]!).getByText(platformName('vrchat'))).toBeTruthy()
    expect(within(rows[1]!).getByText(platformName('chilloutvr'))).toBeTruthy()

    fireEvent.click(
      within(region).getByRole('button', {
        name: msg('dashboard.glance.seeAllInvitesAria', { count: 4 })
      })
    )
    expect(useUiStore.getState().activeTab).toBe('inbox')
  })

  it('follows the platform filter and shows a quiet line when nothing came in', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardHideEmpty: false } })
    inboxItems = [invite('vrchat', 'v-new', 'Aria', 5)]
    renderGlance(['chilloutvr'])
    const region = await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    await waitFor(() => expect(bridge.getInbox).toHaveBeenCalled())
    expect(within(region).getByText(msg('dashboard.glance.noInvites'))).toBeTruthy()
    expect(within(region).queryByText('Aria')).toBeNull()
    expect(within(region).queryByRole('button')).toBeNull()
  })

  it('keeps rows but drops the Inbox links while the Inbox page is hidden', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, showInboxPage: false } })
    inboxItems = [invite('vrchat', 'v-new', 'Aria', 5)]
    renderGlance()
    const region = await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    await within(region).findByText('Aria')
    expect(within(region).queryByRole('button')).toBeNull()
  })
})

describe('DashboardGlance: hide empty sections', () => {
  it('drops Latest invites with nothing in it and gives Wearing now the whole row', async () => {
    renderGlance()
    await wornRow(vrcWorn)
    await waitFor(() => expect(bridge.getInbox).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: msg('dashboard.glance.invites') })).toBeNull()
    const worn = screen.getByRole('region', { name: msg('avatars.wearingNow') })
    // The lone section is the grid's only child, which lays its rows side by side.
    expect(worn.parentElement?.children).toHaveLength(1)
  })

  it('brings Latest invites back as soon as one arrives', async () => {
    renderGlance()
    await wornRow(vrcWorn)
    inboxItems = [invite('vrchat', 'v-new', 'Aria', 5)]
    await act(() => client.invalidateQueries({ queryKey: ['inbox'] }))
    const region = await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    expect(within(region).getByText('Aria')).toBeTruthy()
  })

  it('drops a platform that reported no worn avatar, but keeps loading and failures', async () => {
    bridge.getCurrentAvatar.mockImplementation(({ platform }) =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: true, platform, current: null }
          : { ok: false, reason: 'unavailable' }
      )
    )
    renderGlance()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(msg('avatars.noCurrent.vrchat'))).toBeNull()
  })

  it('removes the whole row when nothing in it has anything to show', async () => {
    bridge.getCurrentAvatar.mockImplementation(({ platform }) =>
      Promise.resolve({ ok: true, platform, current: null })
    )
    const { container } = render(
      <QueryClientProvider client={client}>
        <DashboardGlance platforms={['vrchat', 'chilloutvr']} />
      </QueryClientProvider>
    )
    await waitFor(() => expect(bridge.getCurrentAvatar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})

describe('DashboardGlance: settings', () => {
  it('hides each section on its own switch and reads nothing while worn is off', async () => {
    inboxItems = [invite('vrchat', 'v-new', 'Aria', 5)]
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardWearingNow: false } })
    renderGlance()
    expect(
      await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    ).toBeTruthy()
    expect(screen.queryByRole('region', { name: msg('avatars.wearingNow') })).toBeNull()
    expect(bridge.getCurrentAvatar).not.toHaveBeenCalled()
    cleanup()

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardInvites: false } })
    renderGlance()
    expect(await screen.findByRole('region', { name: msg('avatars.wearingNow') })).toBeTruthy()
    expect(screen.queryByRole('region', { name: msg('dashboard.glance.invites') })).toBeNull()
  })

  it('holds only the sections it is given, in that order', async () => {
    inboxItems = [invite('vrchat', 'v-new', 'Aria', 5)]
    renderGlance(['vrchat', 'chilloutvr'], ['invites'])
    expect(
      await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    ).toBeTruthy()
    expect(screen.queryByRole('region', { name: msg('avatars.wearingNow') })).toBeNull()
    expect(bridge.getCurrentAvatar).not.toHaveBeenCalled()
    cleanup()

    renderGlance(['vrchat', 'chilloutvr'], ['invites', 'wearing-now'])
    const invites = await screen.findByRole('region', { name: msg('dashboard.glance.invites') })
    const worn = await screen.findByRole('region', { name: msg('avatars.wearingNow') })
    expect(invites.compareDocumentPosition(worn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders nothing with both off', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, dashboardWearingNow: false, dashboardInvites: false }
    })
    const { container } = render(
      <QueryClientProvider client={client}>
        <DashboardGlance platforms={['vrchat', 'chilloutvr']} />
      </QueryClientProvider>
    )
    expect(container.innerHTML).toBe('')
    expect(bridge.getCurrentAvatar).not.toHaveBeenCalled()
  })
})
