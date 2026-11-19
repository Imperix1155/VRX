import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'

/**
 * App settings store (VRX-21). Seeds from `DEFAULT_SETTINGS`; the schema and
 * migration runner live in `@shared/settings` (VRX-23).
 *
 * Persisted (VRX-184): `hooks/useSettingsPersistence` (mounted in App.tsx)
 * loads via `get-settings` into `setSettings` on startup and saves on the
 * `dirty` flag over `save-settings`. `answerSave` records that main answered
 * that exact settings object. `markSaved` is the successful answer.
 *
 * Hydration (VRX-212): `hydrated` starts false so the first paint cannot flash
 * a persisted non-default theme/glow. It flips true once the initial
 * `getSettings()` load resolves (success or failure), or immediately when the
 * preload bridge is absent (Preview/tests).
 */
interface SettingsState {
  settings: Settings
  /** True when in-memory settings differ from the last loaded/persisted state. */
  dirty: boolean
  /** True once the initial persisted-settings load has resolved. */
  hydrated: boolean
  /** The persistence notice. It stays set across later edits until a save
   *  succeeds, so it is not an acknowledgement of the current snapshot.
   *  Read `acknowledgedSettings` for what main has applied. */
  saveError: boolean
  /** The settings object main has applied: the one loaded or adopted, or the
   *  exact object whose save main has answered (the write can still have
   *  failed). A later edit replaces `settings` and is not this object. */
  acknowledgedSettings: Settings
  /** True while main answered the load with defaults because the settings file
   *  could not be read; cleared once a save reaches the real file. */
  loadFallback: boolean
  /** True when the settings file came from a newer VRX, so main keeps it
   *  untouched and no save can succeed until VRX is updated. */
  newerFile: boolean
  /** True when main found a damaged settings file this run and started from
   *  defaults; cleared when the user hides the notice. */
  resetNotice: boolean
  saving: boolean
  saveAttempt: number
  retrySave: () => void
  /** Replace settings wholesale (e.g. after loading persisted state); clears dirty. */
  setSettings: (settings: Settings) => void
  /** Merge a partial update; marks dirty only when a value actually changes. */
  updateSettings: (patch: Partial<Settings>) => void
  /** Clear the dirty flag (after a successful persist) and acknowledge it. */
  markSaved: () => void
  /** Main answered a save of this exact object. `failed` keeps the store dirty
   *  and raises the notice; `saved` clears both. A newer edit is ignored. */
  answerSave: (snapshot: Settings, outcome: 'saved' | 'failed') => void
  /** Mark the store hydrated so the UI may reveal itself. */
  hydrate: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  dirty: false,
  hydrated: false,
  saveError: false,
  acknowledgedSettings: DEFAULT_SETTINGS,
  loadFallback: false,
  newerFile: false,
  resetNotice: false,
  saving: false,
  saveAttempt: 0,
  retrySave: () => set((state) => ({ saveAttempt: state.saveAttempt + 1 })),
  setSettings: (settings) =>
    set({
      settings,
      dirty: false,
      saveError: false,
      saving: false,
      acknowledgedSettings: settings
    }),
  updateSettings: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch }
      const changed = (Object.keys(patch) as (keyof Settings)[]).some(
        (key) => state.settings[key] !== next[key]
      )
      return { settings: next, dirty: state.dirty || changed }
    }),
  markSaved: () => {
    get().answerSave(get().settings, 'saved')
  },
  answerSave: (snapshot, outcome) =>
    set((state) => {
      if (state.settings !== snapshot) return state
      return outcome === 'saved'
        ? { dirty: false, saveError: false, saving: false, acknowledgedSettings: snapshot }
        : { saveError: true, saving: false, acknowledgedSettings: snapshot }
    }),
  hydrate: () => set({ hydrated: true })
}))
