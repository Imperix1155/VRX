import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings'

/**
 * Settings persistence bridge (VRX-184). Mount ONCE, top-level in App.tsx
 * (same pattern as useLiveFriendEvents).
 *
 * Boot: loads the persisted settings over `get-settings` into the store
 * (replaces the defaults wholesale — main has already migrated + validated).
 * Change: whenever the store turns dirty, saves the CURRENT settings as the
 * patch over `save-settings`, then `markSaved`. A change landing while a save
 * is in flight cancels the stale completion and re-saves the latest state, so
 * only the newest save marks the store clean. A failed save (e.g. main's
 * newer-version rollback refusal) leaves the store dirty — the session keeps
 * working in-memory and the next change retries.
 *
 * Guards `window.vrx` absence (Preview/tests): everything stays in-memory.
 */
export function useSettingsPersistence(): void {
  const setSettings = useSettingsStore((s) => s.setSettings)
  const settings = useSettingsStore((s) => s.settings)
  const dirty = useSettingsStore((s) => s.dirty)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) return
    let cancelled = false
    window.vrx
      .getSettings()
      .then((persisted) => {
        if (!cancelled) setSettings(persisted)
      })
      .catch(() => {
        // Load never throws in main; only a bridge failure lands here — the
        // in-memory defaults remain in effect for the session.
      })
    return () => {
      cancelled = true
    }
  }, [setSettings])

  useEffect(() => {
    if (!dirty || typeof window === 'undefined' || !window.vrx) return
    let cancelled = false
    window.vrx
      .saveSettings({ patch: settings })
      .then(() => {
        if (!cancelled) useSettingsStore.getState().markSaved()
      })
      .catch(() => {
        // Leave dirty (retried on the next change). The only expected rejection
        // is the deliberate newer-version rollback refusal.
      })
    return () => {
      cancelled = true
    }
  }, [dirty, settings])
}
