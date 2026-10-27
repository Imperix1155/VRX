// @vitest-environment jsdom
/**
 * SettingsView tests (CodeRabbit follow-up on VRX-78): the Behavior section's
 * hot-threshold row — stepper reflects the store and writes back through
 * updateSettings. jsdom renders client-side, so the REAL zustand store applies.
 *
 * VRX-37 added the Accounts category (ChilloutVrAccountCard uses `useAuthStatus`,
 * a TanStack Query hook — SettingsView now needs a QueryClientProvider ancestor).
 */
import { act, fireEvent, within, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { ISSUES_URL, releasesUrlFor } from '@shared/constants'
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
    failure: null
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
    failure: null
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
    act(() => useUiStore.setState({ settingsCategory: 'dashboard' }))
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
  })

  it('the category list reads appearance/dashboard/behavior/notifications/accounts/about', () => {
    expect([...SETTINGS_CATEGORIES]).toEqual([
      'appearance',
      'dashboard',
      'behavior',
      'notifications',
      'accounts',
      'about'
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

  it('renders the background-glow options in Off | Muted | Standard | Vivid order (Standard default)', () => {
    renderSettings()
    const glowGroup = screen.getByRole('radiogroup', { name: msg('settings.backgroundGlow.aria') })
    const labels = [...glowGroup.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(labels).toEqual([
      msg('settings.backgroundGlow.off'),
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

  it('turns the background glow off through updateSettings', () => {
    renderSettings()
    const glowGroup = screen.getByRole('radiogroup', { name: msg('settings.backgroundGlow.aria') })
    fireEvent.click(within(glowGroup).getByText(msg('settings.backgroundGlow.off')))
    expect(useSettingsStore.getState().settings.backgroundGlow).toBe('off')
  })

  it('renders the friends background re-sync row with its note and five cadence options', () => {
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
      msg('settings.reconcileInterval.1h'),
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

describe('SettingsView updater failures (VRX-268)', () => {
  it.each([
    ['check-network', 'updater.settings.failure.checkNetwork'],
    ['download-write', 'updater.settings.failure.downloadWrite'],
    ['staged-install', 'updater.settings.failure.stagedInstall']
  ] as const)(
    'renders localized actionable copy for %s without raw diagnostics',
    (failure, key) => {
      updaterState.state = {
        state: failure === 'staged-install' ? 'update-available' : 'error',
        currentVersion: '0.14.0',
        availableVersion: failure === 'staged-install' ? '0.15.0' : null,
        progressPercent: 0,
        failure
      }

      useUiStore.setState({ settingsCategory: 'about' })
      renderSettings()

      expect(screen.getByText(msg(key))).toBeTruthy()
      expect(screen.queryByText(/EACCES|\/Users\/alice|ENOTFOUND/)).toBeNull()
    }
  )

  it('uses the same broad safe guidance for a network-like download rejection', () => {
    updaterState.state = {
      state: 'error',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      failure: 'download-write'
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    expect(
      screen.getByText(
        "Couldn't download the update. Check your connection and available storage, then try again. If it keeps failing, install the latest release manually."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/ENOTFOUND|ECONNRESET|https:\/\//)).toBeNull()
  })
})

describe('SettingsView — Behavior section (VRX-78/231)', () => {
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

  it('renders joining enabled by default and persists the disabled choice (VRX-39)', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const toggle = screen.getByRole('radiogroup', {
      name: msg('settings.allowJoinInstances.aria')
    })
    expect(toggle.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.boolean.on')
    )

    fireEvent.click(toggle.querySelector('[aria-checked="false"]')!)
    expect(useSettingsStore.getState().settings.allowJoinInstances).toBe(false)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('keeps both open-game choices in one row and Off keeps the VRChat choice', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    const group = screen.getByRole('radiogroup', { name: msg('settings.openGameJoin.aria') })
    const option = (key: string): HTMLElement =>
      within(group).getByRole('radio', { name: msg(`settings.openGameJoin.${key}`) })
    expect(option('go').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(option('invite'))
    expect(useSettingsStore.getState().settings).toMatchObject({
      joinOpenGame: true,
      vrchatOpenGameJoin: 'invite'
    })

    fireEvent.click(option('off'))
    expect(useSettingsStore.getState().settings).toMatchObject({
      joinOpenGame: false,
      vrchatOpenGameJoin: 'invite'
    })
    expect(option('off').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(option('go'))
    expect(useSettingsStore.getState().settings).toMatchObject({
      joinOpenGame: true,
      vrchatOpenGameJoin: 'go'
    })
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
  it('renders the friend and hot instance alert controls and writes changes to the settings store', () => {
    useUiStore.setState({ settingsCategory: 'notifications' })
    renderSettings()

    const online = screen.getByRole('radiogroup', {
      name: msg('settings.notifications.online.aria')
    })
    const inGame = screen.getByRole('radiogroup', {
      name: msg('settings.notifications.inGame.aria')
    })
    const offline = screen.getByRole('radiogroup', {
      name: msg('settings.notifications.offline.aria')
    })
    const hotAlert = screen.getByRole('radiogroup', {
      name: msg('settings.notifications.hotInstance.aria')
    })
    for (const group of [online, inGame, offline, hotAlert]) {
      expect(
        within(group)
          .getByRole('radio', { name: msg('settings.boolean.off') })
          .getAttribute('aria-checked')
      ).toBe('true')
    }
    fireEvent.click(within(online).getByRole('radio', { name: msg('settings.boolean.on') }))
    fireEvent.click(within(offline).getByRole('radio', { name: msg('settings.boolean.on') }))
    expect(useSettingsStore.getState().settings.notifyFriendOnline).toBe(true)
    expect(useSettingsStore.getState().settings.notifyFriendOffline).toBe(true)
    fireEvent.click(within(hotAlert).getByRole('radio', { name: msg('settings.boolean.on') }))
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
    // Same readable dim treatment as the sign-in screen's copy (DESIGN.md §2).
    expect(screen.getByText(msg('shell.unofficialNotice')).className).toContain(
      'text-[var(--text-dim)]'
    )
  })
})

describe('SettingsView — Legal (About page)', () => {
  it('starts closed and opens the full legal text in place', () => {
    const openUrl = vi.fn(() => Promise.resolve())
    setBridge({ openUrl } as unknown as VrxBridge)
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    const toggle = screen.getByRole('button', { name: msg('settings.legal.show') })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(panel?.closest('[inert]')).toBeTruthy()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe(msg('settings.legal.hide'))
    expect(panel?.closest('[inert]')).toBeNull()
    for (const key of ['independent', 'vrchat', 'chilloutvr', 'support', 'privacy', 'license']) {
      expect(within(panel!).getByText(msg(`settings.legal.${key}`))).toBeTruthy()
    }

    fireEvent.click(within(panel!).getByRole('button', { name: msg('settings.legal.report') }))
    expect(openUrl).toHaveBeenCalledWith({ url: ISSUES_URL })
  })
})

describe('SettingsView — Automatic updates row (VRX-113)', () => {
  it('renders on the About page and binds the toggle to autoUpdate', () => {
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    expect(screen.getByText(msg('updater.settings.label'))).toBeTruthy()
    expect(screen.getByText(msg('updater.settings.description'))).toBeTruthy()

    const toggle = screen.getByRole('radiogroup', { name: msg('updater.settings.label') })
    expect(toggle.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('settings.boolean.off')
    )

    fireEvent.click(toggle.querySelector('[aria-checked="false"]')!)
    expect(useSettingsStore.getState().settings.autoUpdate).toBe(true)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('keeps the channel switch in the automatic updates card beside the toggle', () => {
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    const channel = screen.getByRole('radiogroup', { name: msg('updater.settings.channel.aria') })
    const toggle = screen.getByRole('radiogroup', { name: msg('updater.settings.label') })
    const card = channel.closest('.setting-card')
    expect(card).toBeTruthy()
    expect(card).toBe(toggle.closest('.setting-card'))
    expect(card).toBe(
      screen.getByRole('button', { name: msg('updater.settings.check') }).closest('.setting-card')
    )
    expect(screen.getAllByText(msg('updater.settings.label'))).toHaveLength(1)

    expect(channel.querySelector('[aria-checked="true"]')?.textContent).toBe(
      msg('updater.settings.channel.stable')
    )
    fireEvent.click(
      within(channel).getByRole('radio', { name: msg('updater.settings.channel.beta') })
    )
    expect(useSettingsStore.getState().settings.updateChannel).toBe('beta')
  })

  it('idle/error state shows "Check for updates" and triggers a check', () => {
    useUiStore.setState({ settingsCategory: 'about' })
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
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    const button = screen.getByRole('button', { name: msg('updater.settings.checking') })
    // aria-disabled, so a focused button keeps focus while the check runs.
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(updaterState.check).not.toHaveBeenCalled()
  })

  it('update-available state shows the target version and triggers download', () => {
    updaterState.state = {
      state: 'update-available',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
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
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    const button = screen.getByRole('button', {
      name: i18n.t('updater.settings.downloading', { percent: 37 })
    })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(updaterState.download).not.toHaveBeenCalled()
    expect(updaterState.check).not.toHaveBeenCalled()
  })

  it('downloading at 0% shows the indeterminate label, not "Check for updates"', () => {
    updaterState.state = {
      state: 'downloading',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    expect(screen.queryByRole('button', { name: msg('updater.settings.check') })).toBeNull()
    expect(
      screen.getByRole('button', { name: msg('updater.settings.downloadingIndeterminate') })
    ).toBeTruthy()
  })

  it('error state renders the localized check retry guidance', () => {
    updaterState.state = {
      state: 'error',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      failure: 'check-network'
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    expect(screen.getByText(msg('updater.settings.failure.checkNetwork'))).toBeTruthy()
  })

  it('downloaded state shows "Restart to update" and triggers install', () => {
    updaterState.state = {
      state: 'downloaded',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 100,
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
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
      failure: null
    }
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    expect(screen.getByText(msg('updater.settings.unsupportedNote'))).toBeTruthy()
    const button = screen.getByRole('button', { name: msg('updater.settings.releases') })
    fireEvent.click(button)
    // The link follows this build's channel: every release for a test build,
    // the latest release for a full one (url-allowlist.test.ts pins both).
    expect(openUrl).toHaveBeenCalledWith({ url: releasesUrlFor(__APP_VERSION__) })
  })
})

describe('Settings logs row', () => {
  it('asks main to open the logs folder and reports a failure', async () => {
    const openLogsFolder = vi.fn().mockRejectedValue(new Error('Could not open logs folder'))
    setBridge({
      getAuthStatus: vi.fn(),
      login: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn(),
      openLogsFolder
    } as unknown as VrxBridge)
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: msg('settings.logs.open') }))
    expect(openLogsFolder).toHaveBeenCalledOnce()
    expect(openLogsFolder).toHaveBeenCalledWith()
    expect((await screen.findByRole('alert')).textContent).toBe(msg('settings.logs.error'))
  })
})

describe('Settings dependency cards', () => {
  it('keeps the threshold visible and independent of the Dashboard Hot Instances switch', () => {
    useUiStore.setState({ settingsCategory: 'dashboard' })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 7, notifyHotInstance: true }
    })
    renderSettings()
    const parent = screen.getByRole('radiogroup', { name: msg('settings.dashboard.hot.label') })
    fireEvent.click(within(parent).getByRole('radio', { name: msg('settings.boolean.off') }))
    expect(screen.getByRole('spinbutton').getAttribute('aria-valuenow')).toBe('7')
    expect(
      screen.queryByRole('radiogroup', { name: msg('settings.notifications.hotInstance.aria') })
    ).toBeNull()
    expect(useSettingsStore.getState().settings).toMatchObject({
      hotInstancesEnabled: false,
      hotInstanceThreshold: 7,
      notifyHotInstance: true,
      dashboardPopularNow: true
    })
  })
  it('moves Dashboard sections and keeps the older order field in step', () => {
    useUiStore.setState({ settingsCategory: 'dashboard' })
    renderSettings()
    const list = screen.getByRole('list', { name: msg('settings.dashboard.sections.label') })
    const names = (): string[] =>
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('p')?.textContent ?? '')
    expect(names()).toEqual([
      msg('settings.dashboard.wearingNow.label'),
      msg('settings.dashboard.invites.label'),
      msg('settings.dashboard.popular.label'),
      msg('settings.dashboard.hot.label')
    ])
    const hot = msg('settings.dashboard.hot.label')
    const up = screen.getByRole('button', {
      name: i18n.t('settings.dashboard.sections.moveUp', { name: hot })
    })
    fireEvent.click(up)
    expect(useSettingsStore.getState().settings).toMatchObject({
      dashboardSections: ['wearing-now', 'invites', 'hot', 'popular'],
      dashboardSectionOrder: 'hot-first'
    })
    expect(
      screen.getByText(
        i18n.t('settings.dashboard.sections.moved', { name: hot, position: 3, count: 4 })
      )
    ).toBeTruthy()
    fireEvent.click(up)
    fireEvent.click(up)
    expect(names()[0]).toBe(hot)
    // At the top the button stays focusable but does nothing.
    expect(up.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(up)
    expect(useSettingsStore.getState().settings.dashboardSections).toEqual([
      'hot',
      'wearing-now',
      'invites',
      'popular'
    ])
    const wearing = msg('settings.dashboard.wearingNow.label')
    const toggle = screen.getByRole('radiogroup', { name: wearing })
    fireEvent.click(within(toggle).getByRole('radio', { name: msg('settings.boolean.off') }))
    expect(useSettingsStore.getState().settings.dashboardWearingNow).toBe(false)
  })
  it('retains joining choices and returns child focus to the disabled parent', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: false, joinMode: 'desktop' }
    })
    renderSettings()
    const confirmation = screen.getByRole('radiogroup', { name: msg('settings.confirmJoin.aria') })
    within(confirmation)
      .getByRole('radio', { name: msg('settings.boolean.off') })
      .focus()
    act(() => useSettingsStore.getState().updateSettings({ allowJoinInstances: false }))
    expect(screen.queryByRole('radiogroup', { name: msg('settings.confirmJoin.aria') })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: msg('settings.joinMode.aria') })).toBeNull()
    const parent = screen.getByRole('radiogroup', { name: msg('settings.allowJoinInstances.aria') })
    expect(document.activeElement).toBe(
      within(parent).getByRole('radio', { name: msg('settings.boolean.off') })
    )
    fireEvent.click(within(parent).getByRole('radio', { name: msg('settings.boolean.on') }))
    expect(useSettingsStore.getState().settings).toMatchObject({
      confirmJoin: false,
      joinMode: 'desktop'
    })
  })
})

describe('Accounts sign-in from this PC', () => {
  it('offers the same explicit button on both platform cards and no startup import choice', async () => {
    setBridge({
      getAuthStatus: vi.fn(({ platform }: { platform: string }) =>
        Promise.resolve({ platform, state: 'unauthenticated', accountId: null, displayName: null })
      ),
      login: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn()
    })
    useUiStore.setState({ settingsCategory: 'accounts' })
    renderSettings()
    expect(
      await screen.findByRole('button', { name: msg('settings.accounts.import.vrchat') })
    ).toBeTruthy()
    expect(
      await screen.findByRole('button', { name: msg('settings.accounts.import.chilloutvr') })
    ).toBeTruthy()
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0)
  })
})

describe('SettingsView — optional pages and welcome setup (owner, 2026-10-20)', () => {
  it('keeps Appearance to the look: page switches sit in Behavior, setup in About', () => {
    renderSettings()
    expect(screen.queryByText(msg('settings.pages.hot.label'))).toBeNull()
    expect(screen.queryByText(msg('settings.pages.explore.label'))).toBeNull()
    expect(screen.queryByRole('button', { name: msg('settings.setup.run') })).toBeNull()

    act(() => useUiStore.setState({ settingsCategory: 'behavior' }))
    expect(screen.getByText(msg('settings.pages.hot.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.pages.explore.label'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('settings.setup.run') })).toBeNull()

    act(() => useUiStore.setState({ settingsCategory: 'about' }))
    expect(screen.getByRole('button', { name: msg('settings.setup.run') })).toBeTruthy()
    expect(screen.queryByText(msg('settings.pages.hot.label'))).toBeNull()
  })

  it('turns the Hot Instances and Explore pages off independently', () => {
    useUiStore.setState({ settingsCategory: 'behavior' })
    renderSettings()
    for (const [label, key] of [
      ['settings.pages.hot.label', 'showHotInstancesPage'],
      ['settings.pages.explore.label', 'showExplorePage']
    ] as const) {
      const group = screen.getByRole('radiogroup', { name: msg(label) })
      fireEvent.click(within(group).getByRole('radio', { name: msg('settings.boolean.off') }))
      expect(useSettingsStore.getState().settings[key]).toBe(false)
    }
    // Hiding a page leaves its Dashboard section alone.
    expect(useSettingsStore.getState().settings).toMatchObject({
      dashboardPopularNow: true,
      hotInstancesEnabled: true
    })
  })

  it('Run setup again queues the welcome setup without changing other choices', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'light' } })
    useUiStore.setState({ settingsCategory: 'about' })
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: msg('settings.setup.run') }))
    expect(useSettingsStore.getState().settings).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      setupPending: true
    })
  })
})

describe('SettingsView — background picture', () => {
  const PICTURE = 'data:image/jpeg;base64,AAAA'

  function setPictureBridge(overrides: Record<string, unknown> = {}): Record<string, MockFn> {
    const bridge = {
      getAuthStatus: vi.fn().mockResolvedValue({ platform: 'vrchat', state: 'unauthenticated' }),
      getAppBackground: vi.fn().mockResolvedValue(null),
      chooseAppBackground: vi.fn().mockResolvedValue({ ok: true, dataUrl: PICTURE }),
      clearAppBackground: vi.fn().mockResolvedValue(undefined),
      ...overrides
    }
    ;(window as unknown as { vrx?: unknown }).vrx = bridge
    return bridge as Record<string, MockFn>
  }

  it('offers only Choose picture while no picture is set, with the fade choice hidden', async () => {
    setPictureBridge()
    renderSettings()
    expect(await screen.findByRole('button', { name: msg('settings.backgroundPicture.choose') }))
    expect(
      screen.queryByRole('button', { name: msg('settings.backgroundPicture.remove') })
    ).toBeNull()
    const fade = screen.getByRole('radiogroup', {
      name: msg('settings.backgroundPicture.fade.aria'),
      hidden: true
    })
    expect(fade.closest('[inert]')).toBeTruthy()
  })

  it('adopts the kept picture after choosing, then shows Change, Remove and the fade', async () => {
    const bridge = setPictureBridge()
    renderSettings()
    fireEvent.click(
      await screen.findByRole('button', { name: msg('settings.backgroundPicture.choose') })
    )
    expect(
      await screen.findByRole('button', { name: msg('settings.backgroundPicture.change') })
    ).toBeTruthy()
    expect(bridge.chooseAppBackground).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('background-picture-thumb').getAttribute('src')).toBe(PICTURE)
    const fade = screen.getByRole('radiogroup', {
      name: msg('settings.backgroundPicture.fade.aria')
    })
    fireEvent.click(within(fade).getByText(msg('settings.backgroundPicture.fade.high')))
    expect(useSettingsStore.getState().settings.backgroundPictureFade).toBe('high')
  })

  it('removes the picture and returns focus to Choose picture', async () => {
    const bridge = setPictureBridge({
      getAppBackground: vi.fn().mockResolvedValue({ dataUrl: PICTURE })
    })
    renderSettings()
    fireEvent.click(
      await screen.findByRole('button', { name: msg('settings.backgroundPicture.remove') })
    )
    const choose = await screen.findByRole('button', {
      name: msg('settings.backgroundPicture.choose')
    })
    expect(bridge.clearAppBackground).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(choose)
    expect(screen.queryByTestId('background-picture-thumb')).toBeNull()
  })

  it('explains a refused picture and stays quiet when the dialog is cancelled', async () => {
    const bridge = setPictureBridge({
      chooseAppBackground: vi.fn().mockResolvedValue({ ok: false, reason: 'unsupported' })
    })
    renderSettings()
    const choose = await screen.findByRole('button', {
      name: msg('settings.backgroundPicture.choose')
    })
    fireEvent.click(choose)
    expect((await screen.findByRole('alert')).textContent).toBe(
      msg('settings.backgroundPicture.error.unsupported')
    )

    bridge.chooseAppBackground!.mockResolvedValue({ ok: false, reason: 'cancelled' })
    fireEvent.click(choose)
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['too-small', 'settings.backgroundPicture.error.tooSmall'],
    ['too-tall', 'settings.backgroundPicture.error.tooTall'],
    ['too-wide', 'settings.backgroundPicture.error.tooWide']
  ])('explains a picture refused as %s', async (reason, key) => {
    setPictureBridge({
      chooseAppBackground: vi.fn().mockResolvedValue({ ok: false, reason })
    })
    renderSettings()
    fireEvent.click(
      await screen.findByRole('button', { name: msg('settings.backgroundPicture.choose') })
    )
    expect((await screen.findByRole('alert')).textContent).toBe(msg(key))
  })

  function loadThumb(width: number, height: number): void {
    const thumb = screen.getByTestId('background-picture-thumb')
    Object.defineProperty(thumb, 'naturalWidth', { configurable: true, value: width })
    Object.defineProperty(thumb, 'naturalHeight', { configurable: true, value: height })
    fireEvent.load(thumb)
  }

  it('warns about a tall picture and says nothing about a wide, sharp one', async () => {
    setPictureBridge({ getAppBackground: vi.fn().mockResolvedValue({ dataUrl: PICTURE }) })
    renderSettings()
    await screen.findByTestId('background-picture-thumb')
    expect(screen.queryByTestId('background-picture-warning')).toBeNull()

    loadThumb(1080, 1600)
    expect(screen.getByTestId('background-picture-warning').textContent).toBe(
      msg('settings.backgroundPicture.warning.tall')
    )
    loadThumb(1920, 1080)
    expect(screen.queryByTestId('background-picture-warning')).toBeNull()
  })

  it('warns about a small picture and drops the warning once the picture changes', async () => {
    const SECOND = 'data:image/jpeg;base64,BBBB'
    setPictureBridge({
      getAppBackground: vi.fn().mockResolvedValue({ dataUrl: PICTURE }),
      chooseAppBackground: vi.fn().mockResolvedValue({ ok: true, dataUrl: SECOND })
    })
    renderSettings()
    await screen.findByTestId('background-picture-thumb')
    loadThumb(800, 600)
    expect(screen.getByTestId('background-picture-warning').textContent).toBe(
      msg('settings.backgroundPicture.warning.lowRes')
    )

    fireEvent.click(screen.getByRole('button', { name: msg('settings.backgroundPicture.change') }))
    await waitFor(() =>
      expect(screen.getByTestId('background-picture-thumb').getAttribute('src')).toBe(SECOND)
    )
    expect(screen.queryByTestId('background-picture-warning')).toBeNull()
  })
})
