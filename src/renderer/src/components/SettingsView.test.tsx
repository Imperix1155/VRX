// @vitest-environment jsdom
/**
 * SettingsView tests (CodeRabbit follow-up on VRX-78): the Dashboard section's
 * hot-threshold row — stepper reflects the store and writes back through
 * updateSettings. jsdom renders client-side, so the REAL zustand store applies.
 *
 * VRX-37 added the Accounts category (ChilloutVrAccountCard uses `useAuthStatus`,
 * a TanStack Query hook — SettingsView now needs a QueryClientProvider ancestor).
 */
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
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

describe('SettingsView — Accounts section (VRX-37)', () => {
  function setUnauthenticatedBridge(login: ReturnType<typeof vi.fn>): void {
    setBridge({
      getAuthStatus: vi
        .fn()
        .mockResolvedValue({ platform: 'chilloutvr', state: 'unauthenticated', displayName: null }),
      login
    })
  }

  function renderAccountsPage(): void {
    useUiStore.setState({ settingsCategory: 'accounts' })
    renderSettings()
  }

  function fillCvrCredentials(username = 'neo', password = 'redpill'): void {
    fireEvent.change(screen.getByLabelText(msg('settings.accounts.chilloutvr.username')), {
      target: { value: username }
    })
    fireEvent.change(screen.getByLabelText(msg('settings.accounts.chilloutvr.password')), {
      target: { value: password }
    })
  }

  async function fillAndSubmit(): Promise<void> {
    await screen.findByLabelText(msg('settings.accounts.chilloutvr.username'))
    fillCvrCredentials()
    fireEvent.click(
      screen.getByRole('button', { name: msg('settings.accounts.chilloutvr.connect') })
    )
  }

  it('renders the Accounts page with the ChilloutVR card when selected', () => {
    setUnauthenticatedBridge(vi.fn())
    renderAccountsPage()
    expect(screen.getByText(msg('settings.accounts.chilloutvr.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
  })

  it('shows the connect form when unauthenticated, and calls window.vrx.login with platform chilloutvr', async () => {
    const login = vi.fn().mockResolvedValue({ ok: true })
    setUnauthenticatedBridge(login)
    renderAccountsPage()

    await fillAndSubmit()

    await waitFor(() => expect(login).toHaveBeenCalled())
    expect(login).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      credentials: { username: 'neo', password: 'redpill' }
    })
  })

  it('shows the connected state with the display name and a disabled Disconnect button', async () => {
    setBridge({
      getAuthStatus: vi.fn().mockResolvedValue({
        platform: 'chilloutvr',
        state: 'authenticated',
        displayName: 'Trinity'
      }),
      login: vi.fn()
    })
    renderAccountsPage()

    await screen.findByText(i18n.t('settings.accounts.chilloutvr.connectedAs', { name: 'Trinity' }))
    const disconnect = screen.getByRole('button', {
      name: msg('settings.accounts.chilloutvr.disconnect')
    })
    expect(disconnect).toHaveProperty('disabled', true)
    expect(disconnect.getAttribute('title')).toBe(
      msg('settings.accounts.chilloutvr.disconnectTitle')
    )
  })

  it('surfaces the generic error on an unexpected needs2fa result (CVR has no 2FA leg)', async () => {
    setUnauthenticatedBridge(
      vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' })
    )
    renderAccountsPage()

    await fillAndSubmit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('settings.accounts.chilloutvr.error.unknown'))
  })

  it('clears the password field after a failed attempt (never retains the secret)', async () => {
    setUnauthenticatedBridge(
      vi.fn().mockResolvedValue({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    )
    renderAccountsPage()

    await fillAndSubmit()

    await screen.findByRole('alert')
    const passwordInput = screen.getByLabelText<HTMLInputElement>(
      msg('settings.accounts.chilloutvr.password')
    )
    expect(passwordInput.value).toBe('')
  })
})
