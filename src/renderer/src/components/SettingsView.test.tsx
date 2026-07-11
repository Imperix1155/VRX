// @vitest-environment jsdom
/**
 * SettingsView tests (CodeRabbit follow-up on VRX-78): the Dashboard section's
 * hot-threshold row — stepper reflects the store and writes back through
 * updateSettings. jsdom renders client-side, so the REAL zustand store applies.
 *
 * VRX-37 added the Accounts category (ChilloutVrAccountCard uses `useAuthStatus`,
 * a TanStack Query hook — SettingsView now needs a QueryClientProvider ancestor).
 */
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import SettingsView from './SettingsView'

// jsdom has no ResizeObserver; the segmented controls' bubble hook needs one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const msg = (key: string): string => i18n.t(key)

type VrxBridge = {
  getAuthStatus: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  verify2fa: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
}

function setBridge(bridge: VrxBridge | undefined): void {
  ;(window as unknown as { vrx?: VrxBridge }).vrx = bridge
}

function renderSettings(): { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsView />
    </QueryClientProvider>
  )
  return { queryClient }
}

afterEach(() => {
  cleanup()
  setBridge(undefined)
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  useUiStore.setState({ settingsCategory: 'appearance' })
})

describe('SettingsView — category mini-pages (VRX-186)', () => {
  it('shows one category at a time, driven by the ui store (nav lives in the TopBar)', () => {
    renderSettings()
    // Appearance is the landing page: theme row visible, threshold row absent.
    expect(screen.getByText(msg('settings.theme.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.hotThreshold.label'))).toBeNull()

    // The category nav renders in the TopBar (contextual slot — see
    // TopBar.test); the view reacts to the store it writes.
    act(() => useUiStore.setState({ settingsCategory: 'dashboard' }))
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
  })

  it('renders the label-scheme options in VRChat | Per-platform | ChilloutVR order (center-neutral rule)', () => {
    renderSettings()
    const group = screen.getByRole('radiogroup', { name: msg('settings.labelScheme.aria') })
    const labels = [...group.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(labels).toEqual([
      msg('settings.labelScheme.vrchat'),
      msg('settings.labelScheme.platformNative'),
      msg('settings.labelScheme.chilloutvr')
    ])
  })

  it('renders NO in-panel category selector — the TopBar slot is the only one (owner rule)', () => {
    renderSettings()
    expect(screen.queryByRole('radiogroup', { name: msg('settings.categories.aria') })).toBeNull()
  })

  it('renders the theme options in Dark | System | Light order (System center, VRX-186)', () => {
    renderSettings()
    const themeGroup = screen.getByRole('radiogroup', { name: msg('settings.theme.aria') })
    const labels = [...themeGroup.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(labels).toEqual([
      msg('settings.theme.dark'),
      msg('settings.theme.system'),
      msg('settings.theme.light')
    ])
  })
})

describe('SettingsView — Dashboard section (VRX-78)', () => {
  it('renders the hot-threshold row with the store value', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 7 } })
    useUiStore.setState({ settingsCategory: 'dashboard' })
    renderSettings()
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    const spin = screen.getByRole('spinbutton', { name: msg('settings.hotThreshold.aria') })
    expect(spin.getAttribute('aria-valuenow')).toBe('7')
  })

  it('the stepper writes hotInstanceThreshold through updateSettings (marks dirty)', () => {
    useUiStore.setState({ settingsCategory: 'dashboard' })
    renderSettings()
    const [increase] = screen.getAllByRole('button', { name: msg('stepper.increase') })
    fireEvent.click(increase!)
    expect(useSettingsStore.getState().settings.hotInstanceThreshold).toBe(3)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})

describe('SettingsView — Notifications section (VRX-84/85)', () => {
  it('renders all four accessible toggles and writes changes to the settings store', () => {
    useUiStore.setState({ settingsCategory: 'notifications' })
    renderSettings()

    const online = screen.getByRole('switch', {
      name: msg('settings.notifications.online.aria')
    })
    const inGame = screen.getByRole('switch', {
      name: msg('settings.notifications.inGame.aria')
    })
    const offline = screen.getByRole('switch', {
      name: msg('settings.notifications.offline.aria')
    })
    const hotInstance = screen.getByRole('switch', {
      name: msg('settings.notifications.hotInstance.aria')
    })
    // VRX-205 quiet defaults: every switch ships OFF.
    expect(online.getAttribute('aria-checked')).toBe('false')
    expect(inGame.getAttribute('aria-checked')).toBe('false')
    expect(offline.getAttribute('aria-checked')).toBe('false')
    expect(hotInstance.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(online)
    fireEvent.click(offline)
    fireEvent.click(hotInstance)
    expect(useSettingsStore.getState().settings.notifyFriendOnline).toBe(true)
    expect(useSettingsStore.getState().settings.notifyFriendOffline).toBe(true)
    expect(useSettingsStore.getState().settings.notifyHotInstance).toBe(true)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})

describe('SettingsView — Accounts section (VRX-191)', () => {
  function renderAccountsPage(): void {
    useUiStore.setState({ settingsCategory: 'accounts' })
    renderSettings()
  }

  it('renders both platform account cards when selected', async () => {
    setBridge({
      getAuthStatus: vi.fn(({ platform }: { platform: string }) =>
        Promise.resolve({ platform, state: 'unauthenticated', displayName: null })
      ),
      login: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn()
    })
    renderAccountsPage()

    expect(await screen.findByText(msg('settings.accounts.vrchat.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.accounts.chilloutvr.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
  })
})
