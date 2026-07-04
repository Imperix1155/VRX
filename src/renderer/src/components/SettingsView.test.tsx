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
})

describe('SettingsView — Dashboard section (VRX-78)', () => {
  it('renders the hot-threshold row with the store value', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, hotInstanceThreshold: 7 } })
    render(<SettingsView />)
    expect(screen.getByText(msg('settings.hotThreshold.label'))).toBeTruthy()
    const spin = screen.getByRole('spinbutton', { name: msg('settings.hotThreshold.aria') })
    expect(spin.getAttribute('aria-valuenow')).toBe('7')
  })

  it('the stepper writes hotInstanceThreshold through updateSettings (marks dirty)', () => {
    render(<SettingsView />)
    const [increase] = screen.getAllByRole('button', { name: msg('stepper.increase') })
    fireEvent.click(increase!)
    expect(useSettingsStore.getState().settings.hotInstanceThreshold).toBe(3)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})
