import { useLayoutEffect } from 'react'
import type { BackgroundGlow } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

/**
 * Pure helper — no DOM side-effects at import time.
 * Applies or removes `data-glow` on <html>. `standard` is the default and is
 * represented by the attribute being ABSENT, matching the theme hook's default.
 */
export function applyGlow(glow: BackgroundGlow): void {
  const el = document.documentElement
  if (glow === 'standard') {
    el.removeAttribute('data-glow')
  } else {
    el.setAttribute('data-glow', glow)
  }
}

/**
 * Reads the stored background-glow choice and applies it immediately.
 * Must be called at the top level of a component tree (App.tsx) so it fires
 * before any frame paints.
 *
 * Hydration gate (VRX-212): the attribute is only touched once the settings
 * store has hydrated. Before then the default `standard` glow styling stays in
 * place, preventing a persisted non-standard glow from flashing over the
 * loading canvas.
 */
export function useApplyGlow(): void {
  const glow = useSettingsStore((s) => s.settings.backgroundGlow)
  const hydrated = useSettingsStore((s) => s.hydrated)

  useLayoutEffect(() => {
    if (!hydrated) return
    applyGlow(glow)
  }, [glow, hydrated])
}
