import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'

/**
 * App settings store (VRX-21). Seeds from `DEFAULT_SETTINGS`; the schema and
 * migration runner live in `@shared/settings` (VRX-23).
 *
 * Persistence is pending: the `get-settings` / `save-settings` IPC channels are
 * not in the contract yet (see `@shared/ipc`). For now this is in-memory — a
 * future change loads via IPC into `setSettings` on startup and calls
 * `markSaved` after persisting `updateSettings` changes.
 */
interface SettingsState {
  settings: Settings
  /** True when in-memory settings differ from the last loaded/persisted state. */
  dirty: boolean
  /** Replace settings wholesale (e.g. after loading persisted state); clears dirty. */
  setSettings: (settings: Settings) => void
  /** Merge a partial update and mark dirty. */
  updateSettings: (patch: Partial<Settings>) => void
  /** Clear the dirty flag (after a successful persist). */
  markSaved: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  dirty: false,
  setSettings: (settings) => set({ settings, dirty: false }),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch }, dirty: true })),
  markSaved: () => set({ dirty: false })
}))
