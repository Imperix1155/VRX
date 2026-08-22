// @vitest-environment jsdom
/**
 * SettingsView tests (CodeRabbit follow-up on VRX-78): the Behavior section's
 * hot-threshold row — stepper reflects the store and writes back through
 * updateSettings. jsdom renders client-side, so the REAL zustand store applies.
 *
 * VRX-37 added the Accounts category (ChilloutVrAccountCard uses `useAuthStatus`,
 * a TanStack Query hook — SettingsView now needs a QueryClientProvider ancestor).
 */
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { UpdaterSnapshot } from '@shared/ipc'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useUiStore, SETTINGS_CATEGORIES } from '../stores/ui'
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

type MockFn = ReturnType<typeof vi.fn>

const updaterState: {
  state: UpdaterSnapshot
  check: MockFn
  download: MockFn
  install: MockFn
} = vi.hoisted(() => ({
  state: {
    state: 'idle',
    currentVersion: '0.14.0',
    availableVersion: null,
    progressPercent: 0,
    errorMessage: null
  },
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))
vi.mock('../hooks/useUpdater', () => ({
  useUpdater: () => updaterState
}))

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

beforeEach(() => {
  updaterState.state = {
    state: 'idle',
    currentVersion: '0.14.0',
    availableVersion: null,
    progressPercent: 0,
    errorMessage: null
  }
  updaterState.check.mockReset()
  updaterState.download.mockReset()
  updaterState.install.mockReset()
})

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
    act(() => useUiStore.setState({ settingsCategory: 'behavior' }))
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
  })

  it('the category list reads appearance/behavior/notifications/accounts (VRX-231)', () => {
    expect([...SETTINGS_CATEGORIES]).toEqual([
      'appearance',
      'behavior',
      'notifications',
      'accounts'
    ])
  })

  it('Appearance no longer renders the rows moved to Behavior (VRX-231)', () => {
    renderSettings()
    expect(screen.queryByText(msg('settings.drawerOpener.label'))).toBeNull()
    expect(screen.queryByText(msg('settings.reconcileInterval.label'))).toBeNull()
    expect(screen.queryByText(msg('settings.hotThreshold.label'))).toBeNull()
    expect(screen.queryByText(msg('settings.confirmJoin.label'))).toBeNull()
    expect(screen.queryByText(msg('settings.joinMode.label'))).toBeNull()
    // Appearance keeps: theme, background glow, instance labels.
    expect(screen.getByText(msg('settings.theme.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.backgroundGlow.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.labelScheme.label'))).toBeTruthy()
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

  it('renders the drawer-opener row in Whole card | Avatar only order and writes through updateSettings (VRX-228)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const group = screen.getByRole('radiogroup', { name: msg('settings.drawerOpener.aria') })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((radio) => radio.textContent)).toEqual([
      msg('settings.drawerOpener.card'),
      msg('settings.drawerOpener.avatar')
    ])
    // Default: whole card (owner ruling 2026-07-27).
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.drawerOpener.card')
    )

    fireEvent.click(radios[1]!)
    expect(useSettingsStore.getState().settings.drawerOpener).toBe('avatar')
    expect(useSettingsStore.getState().dirty).toBe(true)
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

  it('renders the background-glow options in Muted | Standard | Vivid order (Standard default)', () => {
    renderSettings()
    const glowGroup = screen.getByRole('radiogroup', { name: msg('settings.backgroundGlow.aria') })
    const labels = [...glowGroup.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(labels).toEqual([
      msg('settings.backgroundGlow.muted'),
      msg('settings.backgroundGlow.standard'),
      msg('settings.backgroundGlow.vivid')
    ])
  })

  it('reflects the stored background-glow choice and writes changes through updateSettings', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, backgroundGlow: 'vivid' } })
    renderSettings()

    const glowGroup = screen.getByRole('radiogroup', { name: msg('settings.backgroundGlow.aria') })
    expect(glowGroup.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.backgroundGlow.vivid')
    )

    const muted = [...glowGroup.querySelectorAll('[role="radio"]')].find(
      (b) => b.textContent === msg('settings.backgroundGlow.muted')
    )
    expect(muted).toBeTruthy()
    fireEvent.click(muted!)
    expect(useSettingsStore.getState().settings.backgroundGlow).toBe('muted')
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('renders the friends background re-sync row with its note and four cadence options', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    expect(screen.getByText(msg('settings.reconcileInterval.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.reconcileInterval.note'))).toBeTruthy()
    const group = screen.getByRole('radiogroup', {
      name: msg('settings.reconcileInterval.aria')
    })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((radio) => radio.textContent)).toEqual([
      msg('settings.reconcileInterval.5m'),
      msg('settings.reconcileInterval.10m'),
      msg('settings.reconcileInterval.30m'),
      msg('settings.reconcileInterval.manual')
    ])
    expect(radios.filter((radio) => radio.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('reflects and saves the stored friends background re-sync cadence', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, reconcileInterval: '30m' } })
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const group = screen.getByRole('radiogroup', {
      name: msg('settings.reconcileInterval.aria')
    })
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.reconcileInterval.30m')
    )

    const manual = [...group.querySelectorAll('[role="radio"]')].find(
      (radio) => radio.textContent === msg('settings.reconcileInterval.manual')
    )
    expect(manual).toBeTruthy()
    fireEvent.click(manual!)
    expect(useSettingsStore.getState().settings.reconcileInterval).toBe('manual')
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})

describe('SettingsView — Behavior section (VRX-78/231)', () => {
  it('renders the hot-threshold row with the store value', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 7 } })
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    const spin = screen.getByRole('spinbutton', { name: msg('settings.hotThreshold.aria') })
    expect(spin.getAttribute('aria-valuenow')).toBe('7')
  })

  it('the stepper writes hotInstanceThreshold through updateSettings (marks dirty)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const [increase] = screen.getAllByRole('button', { name: msg('stepper.increase') })
    fireEvent.click(increase!)
    expect(useSettingsStore.getState().settings.hotInstanceThreshold).toBe(3)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('renders joining enabled by default and persists the disabled choice (VRX-39)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const toggle = screen.getByRole('switch', {
      name: msg('settings.allowJoinInstances.aria')
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)
    expect(useSettingsStore.getState().settings.allowJoinInstances).toBe(false)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('renders the confirm-before-joining row (On default) and writes confirmJoin (VRX-210)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const group = screen.getByRole('radiogroup', { name: msg('settings.confirmJoin.aria') })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((radio) => radio.textContent)).toEqual([
      msg('settings.confirmJoin.on'),
      msg('settings.confirmJoin.off')
    ])
    // Cautious-by-default (owner ruling): On.
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.confirmJoin.on')
    )

    fireEvent.click(radios[1]!)
    expect(useSettingsStore.getState().settings.confirmJoin).toBe(false)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('renders the join-mode row in VR | Always ask | Desktop order (center-neutral) and writes joinMode (VRX-210)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const group = screen.getByRole('radiogroup', { name: msg('settings.joinMode.aria') })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    // 'ask' DEFERS the choice to join time — the §8 center-neutral seat.
    expect(radios.map((radio) => radio.textContent)).toEqual([
      msg('settings.joinMode.vr'),
      msg('settings.joinMode.ask'),
      msg('settings.joinMode.desktop')
    ])
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.joinMode.ask')
    )

    fireEvent.click(radios[0]!)
    expect(useSettingsStore.getState().settings.joinMode).toBe('vr')
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
        Promise.resolve({ platform, state: 'unauthenticated', accountId: null, displayName: null })
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

describe('SettingsView — Automatic updates row (VRX-113)', () => {
  it('renders on the Behavior page and binds the toggle to autoUpdate', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    expect(screen.getByText(msg('updater.settings.label'))).toBeTruthy()
    expect(screen.getByText(msg('updater.settings.description'))).toBeTruthy()

    const toggle = screen.getByRole('switch', { name: msg('updater.settings.label') })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)
    expect(useSettingsStore.getState().settings.autoUpdate).toBe(true)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('idle/error state shows "Check for updates" and triggers a check', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const button = screen.getByRole('button', { name: msg('updater.settings.check') })
    fireEvent.click(button)
    expect(updaterState.check).toHaveBeenCalledOnce()
  })

  it('checking state shows "Checking…" and disables the button', () => {
    updaterState.state = {
      state: 'checking',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const button = screen.getByRole('button', { name: msg('updater.settings.checking') })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('update-available state shows the target version and triggers download', () => {
    updaterState.state = {
      state: 'update-available',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const button = screen.getByRole('button', {
      name: i18n.t('updater.settings.updateTo', { version: '0.15.0' })
    })
    fireEvent.click(button)
    expect(updaterState.download).toHaveBeenCalledOnce()
  })

  it('downloading state shows progress and disables the button', () => {
    updaterState.state = {
      state: 'downloading',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 37,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const button = screen.getByRole('button', {
      name: i18n.t('updater.settings.downloading', { percent: 37 })
    })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('downloading at 0% shows the indeterminate label, not "Check for updates"', () => {
    updaterState.state = {
      state: 'downloading',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    expect(screen.queryByRole('button', { name: msg('updater.settings.check') })).toBeNull()
    expect(
      screen.getByRole('button', { name: msg('updater.settings.downloadingIndeterminate') })
    ).toBeTruthy()
  })

  it('error state renders the error message as quiet helper text', () => {
    updaterState.state = {
      state: 'error',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      errorMessage: 'network down'
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    expect(screen.getByText('network down')).toBeTruthy()
  })

  it('downloaded state shows "Restart to update" and triggers install', () => {
    updaterState.state = {
      state: 'downloaded',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 100,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    const button = screen.getByRole('button', { name: msg('updater.settings.restart') })
    fireEvent.click(button)
    expect(updaterState.install).toHaveBeenCalledOnce()
  })

  it('unsupported state shows "Open releases page" and opens the allowlisted URL', () => {
    const openUrl = vi.fn()
    setBridge({
      getAuthStatus: vi.fn(),
      login: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn(),
      openUrl
    } as unknown as VrxBridge)
    updaterState.state = {
      state: 'unsupported',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      errorMessage: null
    }
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()

    expect(screen.getByText(msg('updater.settings.unsupportedNote'))).toBeTruthy()
    const button = screen.getByRole('button', { name: msg('updater.settings.releases') })
    fireEvent.click(button)
    expect(openUrl).toHaveBeenCalledWith({
      url: 'https://github.com/Imperix1155/VRX/releases/latest'
    })
  })
})
