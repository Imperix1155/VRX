// @vitest-environment jsdom
/**
 * Alerts for picked friends: the Settings scope control, the review list
 * behind Show, and the "Alert me about this friend" switch in the details
 * panel. Both platforms get the same controls.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { friendsQueryKey } from '../queries/friends'
import SettingsView from './SettingsView'
import AlertPickRow from './AlertPickRow'
import FriendDrawer from './FriendDrawer'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)
vi.mock('../hooks/useUpdater', () => ({
  useUpdater: () => ({
    state: {
      state: 'idle',
      currentVersion: '1.0.0',
      availableVersion: null,
      progressPercent: 0,
      failure: null
    },
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn()
  })
}))

const msg = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options)

function friend(platform: Platform, platformUserId: string, displayName: string): Friend {
  return {
    platformUserId,
    platform,
    displayName,
    avatarUrl: null,
    presence: { state: 'active' },
    status: platform === 'vrchat' ? 'online' : null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as Friend
}

let stored: Record<Platform, Set<string>>
let setAlertPick: ReturnType<typeof vi.fn>

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
  stored = { vrchat: new Set(['usr_alex', 'usr_gone']), chilloutvr: new Set(['cvr_mika']) }
  setAlertPick = vi.fn(
    async ({
      platform,
      friendIds,
      picked
    }: {
      platform: Platform
      friendIds: string[]
      picked: boolean
    }) => {
      for (const friendId of friendIds) {
        if (picked) stored[platform].add(friendId)
        else stored[platform].delete(friendId)
      }
      return { ok: true }
    }
  )
  window.vrx = {
    getAuthStatus: vi.fn(async ({ platform }: { platform: Platform }) => ({
      platform,
      state: 'authenticated',
      accountId: `${platform}-me`,
      displayName: 'Me'
    })),
    getAlertPicks: vi.fn(async ({ platform }: { platform: Platform }) => ({
      friendIds: [...stored[platform]],
      revision: { platformAccountId: `${platform}-me`, epoch: 1 }
    })),
    setAlertPick,
    getFriendNote: vi.fn(async () => ({ note: null })),
    getAvatar: vi.fn(async () => null)
  } as unknown as Window['vrx']
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  useUiStore.setState({ settingsCategory: 'appearance' })
})

function withClient(node: React.ReactNode): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(friendsQueryKey('vrchat'), [friend('vrchat', 'usr_alex', 'Alex')])
  queryClient.setQueryData(friendsQueryKey('chilloutvr'), [
    friend('chilloutvr', 'cvr_mika', 'Mika')
  ])
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
  return queryClient
}

describe('Settings → Notifications: who alerts you', () => {
  it('defaults to everyone with the picked list folded away', () => {
    useUiStore.setState({ settingsCategory: 'notifications' })
    withClient(<SettingsView />)
    const scope = screen.getByRole('radiogroup', { name: msg('settings.notifications.scope.aria') })
    expect(
      within(scope)
        .getByRole('radio', { name: msg('settings.notifications.scope.everyone') })
        .getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.getByText(msg('settings.notifications.picked.show')).closest('[inert]')
    ).not.toBeNull()

    fireEvent.click(
      within(scope).getByRole('radio', { name: msg('settings.notifications.scope.picked') })
    )
    expect(useSettingsStore.getState().settings.friendAlertScope).toBe('picked')
  })

  it('counts both platforms and lists picks with a Remove for each', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, friendAlertScope: 'picked' },
      dirty: false
    })
    useUiStore.setState({ settingsCategory: 'notifications' })
    withClient(<SettingsView />)

    await screen.findByText(
      msg('settings.notifications.picked.description', { vrchat: 2, chilloutvr: 1 })
    )
    fireEvent.click(screen.getByRole('button', { name: msg('settings.notifications.picked.show') }))

    const list = screen.getByRole('dialog', { name: msg('settings.notifications.picked.title') })
    const vrc = list.querySelector<HTMLElement>('[data-picked-platform="vrchat"]')!
    const cvr = list.querySelector<HTMLElement>('[data-picked-platform="chilloutvr"]')!
    expect(within(vrc).getByText('VRChat')).toBeTruthy()
    expect(within(vrc).getByText('Alex')).toBeTruthy()
    expect(
      within(vrc).getByText(msg('settings.notifications.picked.notInList', { count: 1 }))
    ).toBeTruthy()
    expect(within(cvr).getByText('ChilloutVR')).toBeTruthy()
    expect(within(cvr).getByText('Mika')).toBeTruthy()

    fireEvent.click(
      within(cvr).getByRole('button', {
        name: msg('settings.notifications.picked.removeOne', { name: 'Mika' })
      })
    )
    await waitFor(() =>
      expect(setAlertPick).toHaveBeenCalledWith({
        platform: 'chilloutvr',
        friendIds: ['cvr_mika'],
        picked: false,
        revision: { platformAccountId: 'chilloutvr-me', epoch: 1 }
      })
    )
    await within(cvr).findByText(msg('settings.notifications.picked.none'))
  })
})

describe('AlertPickRow', () => {
  it('picks one friend on their own platform', async () => {
    withClient(<AlertPickRow accounts={[friend('chilloutvr', 'cvr_new', 'Nova')]} name="Nova" />)
    const toggle = screen.getByRole('radiogroup', {
      name: msg('drawer.alerts.aria', { name: 'Nova' })
    })
    await waitFor(() =>
      expect(
        within(toggle)
          .getByRole('radio', { name: msg('settings.boolean.on') })
          .getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    fireEvent.click(within(toggle).getByRole('radio', { name: msg('settings.boolean.on') }))
    await waitFor(() =>
      expect(setAlertPick).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'chilloutvr', friendIds: ['cvr_new'], picked: true })
      )
    )
    expect(
      within(toggle)
        .getByRole('radio', { name: msg('settings.boolean.on') })
        .getAttribute('aria-checked')
    ).toBe('true')
  })

  it('treats a linked person as one pick across both platforms', async () => {
    withClient(
      <AlertPickRow
        accounts={[friend('vrchat', 'usr_alex', 'Alex'), friend('chilloutvr', 'cvr_alex', 'Alex')]}
        name="Alex"
      />
    )
    const toggle = screen.getByRole('radiogroup', {
      name: msg('drawer.alerts.aria', { name: 'Alex' })
    })
    // Only the VRChat account is picked, so the person reads as not picked.
    await waitFor(() =>
      expect(
        within(toggle)
          .getByRole('radio', { name: msg('settings.boolean.on') })
          .getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    expect(
      within(toggle)
        .getByRole('radio', { name: msg('settings.boolean.off') })
        .getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(within(toggle).getByRole('radio', { name: msg('settings.boolean.on') }))
    await waitFor(() => expect(stored.chilloutvr.has('cvr_alex')).toBe(true))
    expect(stored.vrchat.has('usr_alex')).toBe(true)
  })

  it('shows a plain failure line and rolls back when saving is refused', async () => {
    setAlertPick.mockResolvedValue({ ok: false, reason: 'stale' })
    withClient(<AlertPickRow accounts={[friend('vrchat', 'usr_new', 'Nova')]} name="Nova" />)
    const toggle = screen.getByRole('radiogroup', {
      name: msg('drawer.alerts.aria', { name: 'Nova' })
    })
    await waitFor(() =>
      expect(
        within(toggle)
          .getByRole('radio', { name: msg('settings.boolean.on') })
          .getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    await act(async () => {
      fireEvent.click(within(toggle).getByRole('radio', { name: msg('settings.boolean.on') }))
    })
    await screen.findByText(msg('drawer.alerts.saveFailed'))
    await waitFor(() =>
      expect(
        within(toggle)
          .getByRole('radio', { name: msg('settings.boolean.off') })
          .getAttribute('aria-checked')
      ).toBe('true')
    )
  })
})

describe('FriendDrawer alerts section', () => {
  for (const platform of ['vrchat', 'chilloutvr'] as const) {
    it(`shows the ${platform} switch only while alerts are limited to picked friends`, () => {
      const shown = friend(platform, platform === 'vrchat' ? 'usr_x' : 'cvr_x', 'Sam')
      withClient(<FriendDrawer friend={shown} onClose={vi.fn()} />)
      const name = msg('drawer.alerts.aria', { name: 'Sam' })
      expect(screen.queryByRole('radiogroup', { name })).toBeNull()

      act(() =>
        useSettingsStore.setState({
          settings: { ...DEFAULT_SETTINGS, friendAlertScope: 'picked' },
          dirty: false
        })
      )
      expect(screen.getByRole('radiogroup', { name })).toBeTruthy()
      expect(screen.getByText(msg('drawer.alerts.label'))).toBeTruthy()
    })
  }
})
