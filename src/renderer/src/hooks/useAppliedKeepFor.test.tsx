// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useAppliedKeepFor } from './useAppliedKeepFor'
import { useSettingsPersistence } from './useSettingsPersistence'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** The real save bridge and the Kept value the lists actually read. */
function KeptProbe(): React.JSX.Element {
  useSettingsPersistence()
  return <span>{useAppliedKeepFor()}</span>
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    acknowledgedSettings: DEFAULT_SETTINGS,
    dirty: false,
    saveError: false
  })
  Reflect.deleteProperty(window, 'vrx')
})

describe('useAppliedKeepFor', () => {
  it('keeps the earlier choice until the save has answered', () => {
    const view = renderHook(() => useAppliedKeepFor())
    expect(view.result.current).toBe('90d')

    // Picked here; main has not applied it yet.
    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: '30d' }))
    expect(view.result.current).toBe('90d')

    act(() => useSettingsStore.getState().markSaved())
    expect(view.result.current).toBe('30d')
  })

  it('counts a choice as applied when its own save failed: main applies it before it writes', () => {
    const view = renderHook(() => useAppliedKeepFor())
    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: 'session' }))
    expect(view.result.current).toBe('90d')
    act(() => {
      const snapshot = useSettingsStore.getState().settings
      useSettingsStore.getState().answerSave(snapshot, 'failed')
    })
    expect(view.result.current).toBe('session')
    expect(useSettingsStore.getState().saveError).toBe(true)
    expect(useSettingsStore.getState().dirty).toBe(true)
  })

  it('follows settings loaded from main at once', () => {
    const view = renderHook(() => useAppliedKeepFor())
    act(() =>
      useSettingsStore.getState().setSettings({ ...DEFAULT_SETTINGS, activityKeepFor: '1y' })
    )
    expect(view.result.current).toBe('1y')
  })

  it('stays put while another setting is being saved', () => {
    const view = renderHook(() => useAppliedKeepFor())
    act(() => useSettingsStore.getState().updateSettings({ activityFilter: 'online' }))
    expect(view.result.current).toBe('90d')
  })

  it('does not publish a later Kept edit while an earlier save error is still set', () => {
    const view = renderHook(() => useAppliedKeepFor())
    act(() => {
      useSettingsStore.getState().updateSettings({ theme: 'light' })
      useSettingsStore.setState({ saveError: true })
    })
    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: '30d' }))
    // The error flag outlives the snapshot it belongs to. This edit has not been answered.
    expect(view.result.current).toBe('90d')
    expect(useSettingsStore.getState().saveError).toBe(true)

    act(() => useSettingsStore.getState().markSaved())
    expect(view.result.current).toBe('30d')
  })

  it('keeps the previous choice after an unrelated save fails, until the Kept save succeeds', async () => {
    const saved = deferred<Settings>()
    const saveSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockReturnValueOnce(saved.promise)
    Object.assign(window, {
      vrx: {
        getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS }),
        saveSettings
      }
    })
    render(<KeptProbe />)
    await waitFor(() => expect(useSettingsStore.getState().hydrated).toBe(true))
    expect(screen.getByText('90d')).toBeTruthy()

    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    await waitFor(() => expect(useSettingsStore.getState().saveError).toBe(true))
    expect(screen.getByText('90d')).toBeTruthy()

    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: '30d' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))
    // Read the value the instance log would use, while this save is still in flight.
    expect(screen.getByText('90d')).toBeTruthy()
    expect(screen.queryByText('30d')).toBeNull()

    await act(async () => {
      saved.resolve(useSettingsStore.getState().settings)
      await saved.promise
    })
    await waitFor(() => expect(screen.getByText('30d')).toBeTruthy())
    expect(useSettingsStore.getState().dirty).toBe(false)
    expect(useSettingsStore.getState().saveError).toBe(false)
  })
})
