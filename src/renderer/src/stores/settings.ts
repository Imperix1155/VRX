import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'

/**
 * App settings store (VRX-21). Seeds from `DEFAULT_SETTINGS`; the schema and
 * migration runner live in `@shared/settings` (VRX-23).
 *
 * Persisted (VRX-184): `hooks/useSettingsPersistence` (mounted in App.tsx)
 * loads via `get-settings` into `setSettings` on startup and saves on the
 * `dirty` flag over `save-settings`, calling `markSaved` on success.
 */
interface SettingsState {
  settings: Settings
  /** True when in-memory settings differ from the last loaded/persisted state. */
  dirty: boolean
  /** Replace settings wholesale (e.g. after loading persisted state); clears dirty. */
  setSettings: (settings: Settings) => void
  /** Merge a partial update; marks dirty only when a value actually changes. */
  updateSettings: (patch: Partial<Settings>) => void
  /** Clear the dirty flag (after a successful persist). */
  markSaved: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  dirty: false,
  setSettings: (settings) => set({ settings, dirty: false }),
  updateSettings: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch }
      const changed = (Object.keys(patch) as (keyof Settings)[]).some(
        (key) => state.settings[key] !== next[key]
      )
      return { settings: next, dirty: state.dirty || changed }
    }),
  markSaved: () => set({ dirty: false })
}))
