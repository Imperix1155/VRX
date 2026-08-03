/**
 * Settings persistence (VRX-23)
 *
 * electron-store backs the user's settings on disk (under `app.getPath('userData')`,
 * resolved by electron-store). The schema, defaults, and migration logic live in
 * `@shared/settings` (pure + unit-tested); this module is the thin main-process
 * wiring: load (migrate + validate on read, then persist the normalized form back)
 * and save (merge/validate immediately, then coalesce disk writes in main).
 *
 * electron-store@11 is ESM-only, so it is bundled into the main process (not
 * externalized) — see `externalizeDepsPlugin` exclude in `electron.vite.config.ts`.
 */
import Store from 'electron-store'
import {
  parseSettings,
  shouldPersistSettings,
  DEFAULT_SETTINGS,
  type Settings
} from '@shared/settings'
import log from '../logger'

let store: Store<Record<string, unknown>> | undefined
let settingsSnapshot: Settings | undefined
const SETTINGS_SAVE_DEBOUNCE_MS = 250

interface SettingsSaveWaiter {
  resolve: (settings: Settings) => void
  reject: (error: unknown) => void
}

interface PendingSettingsSave {
  settings: Settings
  timer: ReturnType<typeof setTimeout>
  waiters: SettingsSaveWaiter[]
}

let pendingSettingsSave: PendingSettingsSave | undefined

// Lazy: electron-store resolves the userData path via `app`, which is only ready
// after `app.whenReady()`. Constructing on first use keeps this import side-effect-free.
function getStore(): Store<Record<string, unknown>> {
  return (store ??= new Store<Record<string, unknown>>({ name: 'settings' }))
}

/**
 * Load settings from disk, migrating + validating on read. Tidies legacy/older
 * files by writing the normalized form back — but NEVER overwrites a file written
 * by a newer build (that would strip its forward fields and lose data on a
 * rollback). Never throws — falls back to in-memory defaults if the store or a
 * migration fails, leaving the on-disk file intact.
 */
export function loadSettings(): Settings {
  // A queued snapshot is newer than disk until the coalesced write completes.
  // Serve it directly so renderer reloads cannot clobber the in-memory truth.
  if (pendingSettingsSave) return pendingSettingsSave.settings

  try {
    // Inside the try (audit W7 review): conf's `store` getter RETHROWS on a
    // corrupted JSON file — outside the try, that throw escaped the "never
    // throws" contract and (post-W7 bootstrap .catch) would exit-loop the app
    // on every launch until the file was hand-deleted.
    const raw = getStore().store
    const settings = parseSettings(raw)
    if (shouldPersistSettings(raw)) {
      getStore().store = settings
    }
    settingsSnapshot = settings
    return settings
  } catch (err) {
    // Plain string, not the raw Error: message/stack are non-enumerable, so the log
    // redaction hook's object-walk can't see inside an Error (house pattern).
    log.warn(
      'settings: load failed; using in-memory defaults, on-disk file left intact',
      err instanceof Error ? err.message : String(err)
    )
    settingsSnapshot = { ...DEFAULT_SETTINGS }
    return settingsSnapshot
  }
}

/** Cheap fire-time view for hot paths. Startup's first load populates it; the
 *  fallback keeps direct/test callers safe without changing IPC behavior. */
export function getSettingsSnapshot(): Settings {
  return settingsSnapshot ?? loadSettings()
}

/**
 * Merge a partial patch over the current in-memory settings immediately, then
 * coalesce disk persistence in main. The returned promise settles when the
 * coalesced write containing this snapshot settles.
 */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const raw = getStore().store
  const next = parseSettings({ ...(settingsSnapshot ?? parseSettings(raw)), ...patch })
  // The renderer has already accepted the patch locally before this call. Keep
  // native fire-time policy coherent even when persistence must be refused.
  settingsSnapshot = next
  if (!shouldPersistSettings(raw)) {
    // Merging an old-shaped patch over a newer-version file would drop the newer
    // build's fields. Refuse rather than lose data — VRX-21 will own the UX.
    throw new Error('settings: refusing to overwrite settings written by a newer version')
  }

  return new Promise<Settings>((resolve, reject) => {
    const waiters = pendingSettingsSave?.waiters ?? []
    if (pendingSettingsSave) clearTimeout(pendingSettingsSave.timer)
    waiters.push({ resolve, reject })
    const timer = setTimeout(flushPendingSettingsSave, SETTINGS_SAVE_DEBOUNCE_MS)
    timer.unref()
    pendingSettingsSave = { settings: next, timer, waiters }
  })
}

/** Synchronously persist any queued settings snapshot (used by before-quit). */
export function flushPendingSettingsSave(): void {
  const pending = pendingSettingsSave
  if (!pending) return
  pendingSettingsSave = undefined
  clearTimeout(pending.timer)
  try {
    if (!shouldPersistSettings(getStore().store)) {
      throw new Error('settings: refusing to overwrite settings written by a newer version')
    }
    getStore().store = pending.settings
    settingsSnapshot = pending.settings
    for (const waiter of pending.waiters) waiter.resolve(pending.settings)
  } catch (error) {
    for (const waiter of pending.waiters) waiter.reject(error)
  }
}
