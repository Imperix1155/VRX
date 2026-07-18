import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'

/**
 * Settings persistence bridge (VRX-184). Mount ONCE, top-level in App.tsx
 * (same pattern as useLiveFriendEvents).
 *
 * Boot: loads the persisted settings over `get-settings` into the store. If
 * the user edited a setting WHILE the load was in flight, their edits are
 * re-applied on top of the persisted values (the delta vs the boot-seed
 * defaults) and stay dirty so they persist — the one unpreservable micro-edge
 * is an explicit boot-window choice of a value that equals the default while
 * the persisted value differs (the persisted value wins).
 *
 * Hydration (VRX-212): the store's `hydrated` flag is set true once the initial
 * load resolves, whether it succeeds or fails. A failed load means the renderer
 * knows it is rendering with the default-seeded settings, so revealing the UI
 * is safe. If the bridge is absent (Preview/tests), hydration happens
 * immediately.
 *
 * Change: whenever the store turns dirty, saves the CURRENT settings as the
 * patch over `save-settings`, then `markSaved`. Saves are GATED until the
 * boot load has landed — saving earlier would patch the default-seeded object
 * over the on-disk file and wipe unrelated persisted fields (Codex [high],
 * PR #116). The clean transition is double-guarded: the effect-cleanup flag
 * AND a snapshot identity check (zustand replaces the settings object on
 * every update), so a stale save resolving before React runs the cleanup can
 * never mark newer unsaved settings clean. A failed save (e.g. main's
 * newer-version rollback refusal) leaves the store dirty — the session keeps
 * working in-memory and the next change retries.
 *
 * Guards `window.vrx` absence (Preview/tests): everything stays in-memory.
 * A FAILED load also keeps saves disabled for the session (no baseline —
 * see the boot rationale above); in-memory behavior is unaffected.
 */
export function useSettingsPersistence(): void {
  const setSettings = useSettingsStore((s) => s.setSettings)
  const hydrate = useSettingsStore((s) => s.hydrate)
  const settings = useSettingsStore((s) => s.settings)
  const dirty = useSettingsStore((s) => s.dirty)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) {
      hydrate()
      return
    }
    let cancelled = false
    window.vrx
      .getSettings()
      .then((persisted) => {
        if (cancelled) return
        const state = useSettingsStore.getState()
        if (state.dirty) {
          // Edited during the load: what differs from the boot seed is the
          // user's; lay it over the persisted values. updateSettings re-marks
          // dirty, so the (now gated-open) save effect persists the merge.
          const delta = Object.fromEntries(
            Object.entries(state.settings).filter(
              ([key, value]) => value !== DEFAULT_SETTINGS[key as keyof Settings]
            )
          ) as Partial<Settings>
          setSettings(persisted)
          useSettingsStore.getState().updateSettings(delta)
        } else {
          setSettings(persisted)
        }
        setLoaded(true)
        hydrate()
      })
      .catch(() => {
        // Load never throws in main — only bridge/IPC breakage lands here.
        // Saves stay disabled (no persisted baseline to patch over), but the
        // UI can still reveal itself because the default-seeded settings are
        // the canonical fallback.
        hydrate()
      })
    return () => {
      cancelled = true
    }
  }, [setSettings, hydrate])

  useEffect(() => {
    if (!loaded || !dirty || typeof window === 'undefined' || !window.vrx) return
    let cancelled = false
    const snapshot = settings
    window.vrx
      .saveSettings({ patch: snapshot })
      .then(() => {
        if (!cancelled && useSettingsStore.getState().settings === snapshot) {
          useSettingsStore.getState().markSaved()
        }
      })
      .catch(() => {
        // Leave dirty (retried on the next change). The only expected rejection
        // is the deliberate newer-version rollback refusal.
      })
    return () => {
      cancelled = true
    }
  }, [loaded, dirty, settings])
}
