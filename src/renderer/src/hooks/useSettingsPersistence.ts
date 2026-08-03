import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'

const SETTINGS_LOAD_MAX_ATTEMPTS = 3
const SETTINGS_LOAD_BACKOFF_MS = 250

function isRateLimitedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'rate_limited'
}

async function loadSettingsWithRetry(load: () => Promise<Settings>): Promise<Settings> {
  for (let attempt = 0; attempt < SETTINGS_LOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await load()
    } catch (error) {
      const canRetry = isRateLimitedError(error) && attempt < SETTINGS_LOAD_MAX_ATTEMPTS - 1
      if (!canRetry) throw error
      await new Promise<void>((resolve) => {
        setTimeout(resolve, SETTINGS_LOAD_BACKOFF_MS * 2 ** attempt)
      })
    }
  }
  throw new Error('Settings failed to load')
}

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
 * load settles. `rate_limited` gets two short exponential-backoff retries;
 * another failure is promoted into the top-level ErrorBoundary rather than
 * leaving a normal-looking session whose saves are silently disabled. If the
 * bridge is absent (Preview/tests), hydration happens immediately.
 *
 * Change: whenever the store turns dirty, hands the current full snapshot to
 * main immediately; main owns disk-write coalescing and quit-time flushing.
 * Saves are GATED until the boot load has landed — saving earlier would patch
 * the default-seeded object over the on-disk file and wipe unrelated persisted
 * fields (Codex [high], PR #116).
 * The clean transition is double-guarded: the effect-cleanup flag AND a
 * snapshot identity check (zustand replaces the settings object on every
 * update), so a stale save resolving before React runs the cleanup can never
 * mark newer unsaved settings clean. A failed save (e.g. main's newer-version
 * rollback refusal) leaves the store dirty — the session keeps working
 * in-memory and the next change retries.
 *
 * Guards `window.vrx` absence (Preview/tests): everything stays in-memory.
 */
export function useSettingsPersistence(): void {
  const setSettings = useSettingsStore((s) => s.setSettings)
  const hydrate = useSettingsStore((s) => s.hydrate)
  const settings = useSettingsStore((s) => s.settings)
  const dirty = useSettingsStore((s) => s.dirty)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) {
      hydrate()
      return
    }
    let cancelled = false
    const bridge = window.vrx
    void loadSettingsWithRetry(() => bridge.getSettings())
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
      .catch((cause: unknown) => {
        if (cancelled) return
        hydrate()
        setLoadError(new Error('Settings failed to load', { cause }))
      })
    return () => {
      cancelled = true
    }
  }, [setSettings, hydrate])

  useEffect(() => {
    if (!loaded || !dirty || typeof window === 'undefined' || !window.vrx) return
    let cancelled = false
    const snapshot = settings
    const bridge = window.vrx
    void bridge
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

  if (loadError) throw loadError
}
