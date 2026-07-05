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
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import AppShell from './AppShell'

vi.mock('../queries/friends', () => ({
  useFriends: () => ({ data: [], isPending: false, isError: false })
}))

// Silence electron-log/renderer (ErrorBoundary imports it): the REAL module
// hangs the vitest worker at import — no IPC bridge in jsdom. Same mock as
// ErrorBoundary.test.
vi.mock('electron-log/renderer', () => ({
  default: { error: vi.fn() }
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
