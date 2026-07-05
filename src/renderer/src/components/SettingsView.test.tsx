// @vitest-environment jsdom
/**
 * SettingsView tests (CodeRabbit follow-up on VRX-78): the Dashboard section's
 * hot-threshold row — stepper reflects the store and writes back through
 * updateSettings. jsdom renders client-side, so the REAL zustand store applies.
 */
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  useUiStore.setState({ settingsCategory: 'appearance' })
})

describe('SettingsView — category mini-pages (VRX-186)', () => {
  it('shows one category at a time and switches via the nav (no-scroll rule)', () => {
    render(<SettingsView />)
    // Appearance is the landing page: theme row visible, threshold row absent.
    expect(screen.getByText(msg('settings.theme.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.hotThreshold.label'))).toBeNull()

    // Switch to Dashboard via the category nav.
    fireEvent.click(screen.getByRole('radio', { name: msg('settings.dashboard.heading') }))
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    expect(screen.queryByText(msg('settings.theme.label'))).toBeNull()
    // Session state survives in the ui store.
    expect(useUiStore.getState().settingsCategory).toBe('dashboard')
  })

  it('renders the theme options in Dark | System | Light order (System center, VRX-186)', () => {
    render(<SettingsView />)
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
    render(<SettingsView />)
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    const spin = screen.getByRole('spinbutton', { name: msg('settings.hotThreshold.aria') })
    expect(spin.getAttribute('aria-valuenow')).toBe('7')
  })

  it('the stepper writes hotInstanceThreshold through updateSettings (marks dirty)', () => {
    useUiStore.setState({ settingsCategory: 'dashboard' })
    render(<SettingsView />)
    const [increase] = screen.getAllByRole('button', { name: msg('stepper.increase') })
    fireEvent.click(increase!)
    expect(useSettingsStore.getState().settings.hotInstanceThreshold).toBe(3)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})
