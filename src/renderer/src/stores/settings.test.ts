import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from './settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  })

  it('seeds from DEFAULT_SETTINGS and starts clean', () => {
    const state = useSettingsStore.getState()
    expect(state.settings).toEqual(DEFAULT_SETTINGS)
    expect(state.dirty).toBe(false)
  })

  it('updateSettings merges a patch and marks dirty', () => {
    useSettingsStore.getState().updateSettings({ theme: 'dark' })
    const state = useSettingsStore.getState()
    expect(state.settings.theme).toBe('dark')
    // other fields untouched
    expect(state.settings.language).toBe(DEFAULT_SETTINGS.language)
    expect(state.dirty).toBe(true)
  })

  it('markSaved clears the dirty flag without changing settings', () => {
    useSettingsStore.getState().updateSettings({ density: 'compact' })
    expect(useSettingsStore.getState().dirty).toBe(true)
    useSettingsStore.getState().markSaved()
    const state = useSettingsStore.getState()
    expect(state.dirty).toBe(false)
    expect(state.settings.density).toBe('compact')
  })

  it('setSettings replaces wholesale and clears dirty', () => {
    useSettingsStore.getState().updateSettings({ theme: 'light' })
    const replacement = { ...DEFAULT_SETTINGS, language: 'ja' }
    useSettingsStore.getState().setSettings(replacement)
    const state = useSettingsStore.getState()
    expect(state.settings).toEqual(replacement)
    expect(state.dirty).toBe(false)
  })
})
