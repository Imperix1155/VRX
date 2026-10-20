// @vitest-environment jsdom
/**
 * AppShell integration test (VRX-186, Codex finding).
 *
 * The per-component tests (TopBar.test, SettingsView.test) each assert their
 * OWN slice of the contextual-slot contract — neither can catch a duplicate
 * selector introduced at a different level (exactly the bug that shipped in
 * 68698ee: TopBar and SettingsView both rendered the category nav). This
 * renders the REAL shell tree and pins the invariant globally: on Settings
 * there is exactly ONE category selector, on content views exactly one
 * platform filter and no category selector.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import { useSettingsStore } from '../stores/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import AppShell from './AppShell'

vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: () => ({ data: [], isPending: false, isError: false })
}))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-test`,
      displayName: 'Test User'
    }
  })
}))

// jsdom has no ResizeObserver (the segmented bubble effects observe their tracks).
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
// Sidebar renders the BUILD-INJECTED version (electron-vite `define`) — absent in vitest.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const msg = (key: string): string => i18n.t(key)

afterEach(() => {
  cleanup()
  useUiStore.setState({ activeTab: 'dashboard', settingsCategory: 'appearance' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('AppShell contextual slot invariant (VRX-186)', () => {
  it('on Settings the whole shell renders exactly ONE category selector and no platform filter', () => {
    useUiStore.setState({ activeTab: 'settings' })
    render(<AppShell />)
    expect(
      screen.getAllByRole('radiogroup', { name: msg('settings.categories.aria') })
    ).toHaveLength(1)
    expect(screen.queryByRole('radiogroup', { name: msg('shell.seg.aria') })).toBeNull()
  })

  it('on a content view the shell renders exactly ONE platform filter and no category selector', () => {
    render(<AppShell />)
    expect(screen.getAllByRole('radiogroup', { name: msg('shell.seg.aria') })).toHaveLength(1)
    expect(screen.queryByRole('radiogroup', { name: msg('settings.categories.aria') })).toBeNull()
  })
})

describe('AppShell optional pages (owner, 2026-10-20)', () => {
  it('falls back to the Dashboard when the open page is turned off', () => {
    useUiStore.setState({ activeTab: 'explore' })
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, showExplorePage: false } })
    render(<AppShell />)
    expect(useUiStore.getState().activeTab).toBe('dashboard')
    expect(screen.getByRole('main', { name: msg('shell.nav.dashboard') })).toBeTruthy()
  })
})

describe('AppShell view switching', () => {
  it('opens each new view at the top instead of the previous view’s scroll offset', () => {
    render(<AppShell />)
    const main = screen.getByRole('main')
    main.scrollTop = 640
    act(() => useUiStore.setState({ activeTab: 'hot' }))
    expect(main.scrollTop).toBe(0)
  })
})
