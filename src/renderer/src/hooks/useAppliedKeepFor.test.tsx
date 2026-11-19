// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useAppliedKeepFor } from './useAppliedKeepFor'

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, saveError: false })
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

  it('counts a choice as applied when its save failed: main applies it before it writes', () => {
    const view = renderHook(() => useAppliedKeepFor())
    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: 'session' }))
    expect(view.result.current).toBe('90d')
    act(() => useSettingsStore.setState({ saveError: true }))
    expect(view.result.current).toBe('session')
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
})
