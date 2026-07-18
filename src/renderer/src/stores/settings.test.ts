import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from './settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, hydrated: false })
  })

  it('seeds from DEFAULT_SETTINGS and starts clean and unhydrated', () => {
    const state = useSettingsStore.getState()
    expect(state.settings).toEqual(DEFAULT_SETTINGS)
    expect(state.dirty).toBe(false)
    expect(state.hydrated).toBe(false)
  })

  it('hydrate marks the store hydrated without changing settings or dirty', () => {
    useSettingsStore.getState().updateSettings({ theme: 'light' })
    useSettingsStore.getState().hydrate()
    const state = useSettingsStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.settings.theme).toBe('light')
    expect(state.dirty).toBe(true)
  })

  it('updateSettings merges a patch and marks dirty', () => {
    useSettingsStore.getState().updateSettings({ theme: 'dark' })
    const state = useSettingsStore.getState()
    expect(state.settings.theme).toBe('dark')
    // other fields untouched
    expect(state.settings.language).toBe(DEFAULT_SETTINGS.language)
    expect(state.dirty).toBe(true)
  })

  it('updateSettings does not mark dirty for a no-op patch', () => {
    const { theme } = useSettingsStore.getState().settings
    useSettingsStore.getState().updateSettings({ theme })
    expect(useSettingsStore.getState().dirty).toBe(false)
  })

  it('updateSettings preserves an existing dirty flag on a later no-op patch', () => {
    useSettingsStore.getState().updateSettings({ theme: 'dark' })
    expect(useSettingsStore.getState().dirty).toBe(true)
    const { density } = useSettingsStore.getState().settings
    useSettingsStore.getState().updateSettings({ density })
    expect(useSettingsStore.getState().dirty).toBe(true)
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

  it('setSettings preserves the hydrated flag', () => {
    useSettingsStore.getState().hydrate()
    useSettingsStore.getState().setSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
    expect(useSettingsStore.getState().hydrated).toBe(true)
  })
})
