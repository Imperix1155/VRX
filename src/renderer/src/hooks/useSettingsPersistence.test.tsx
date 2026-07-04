// @vitest-environment jsdom
/**
 * useSettingsPersistence tests (VRX-184).
 *
 * jsdom renders client-side, so the REAL zustand store applies (the SSR
 * store-snapshot trap only bites renderToStaticMarkup tests). window.vrx is
 * stubbed per test; the store is reset after each.
 */
import { act, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useSettingsPersistence } from './useSettingsPersistence'

function Probe(): React.JSX.Element {
  useSettingsPersistence()
  return <></>
}

type Bridge = {
  getSettings: ReturnType<typeof vi.fn>
  saveSettings: ReturnType<typeof vi.fn>
}

function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'dark' }),
    saveSettings: vi
      .fn()
      .mockImplementation((req: { patch: Settings }) => Promise.resolve(req.patch)),
    ...overrides
  }
  Object.assign(window, { vrx: bridge })
  return bridge
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  Reflect.deleteProperty(window, 'vrx')
})

describe('useSettingsPersistence', () => {
  it('loads persisted settings into the store on mount (dirty stays false)', async () => {
    stubBridge()
    render(<Probe />)
    await waitFor(() => expect(useSettingsStore.getState().settings.theme).toBe('dark'))
    expect(useSettingsStore.getState().dirty).toBe(false)
  })

  it('saves on a dirty change and marks the store clean', async () => {
    const bridge = stubBridge()
    render(<Probe />)
    await waitFor(() => expect(bridge.getSettings).toHaveBeenCalled())
    act(() => useSettingsStore.getState().updateSettings({ labelScheme: 'chilloutvr' }))
    await waitFor(() => expect(useSettingsStore.getState().dirty).toBe(false))
    expect(bridge.saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ labelScheme: 'chilloutvr' })
    })
  })

  it('leaves the store dirty when the save is refused', async () => {
    const bridge = stubBridge({
      saveSettings: vi.fn().mockRejectedValue(new Error('newer version'))
    })
    render(<Probe />)
    await waitFor(() => expect(bridge.getSettings).toHaveBeenCalled())
    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalled())
    // Give the rejected promise a tick to (not) mark saved.
    await act(() => Promise.resolve())
    expect(useSettingsStore.getState().dirty).toBe(true)
    expect(useSettingsStore.getState().settings.theme).toBe('light')
  })

  it('no-ops without the bridge (Preview/tests) — stays in-memory, never throws', () => {
    render(<Probe />)
    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    expect(useSettingsStore.getState().settings.theme).toBe('light')
    expect(useSettingsStore.getState().dirty).toBe(true)
  })
})
