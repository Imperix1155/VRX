import { useLayoutEffect } from 'react'
import type { Theme } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

/**
 * Pure helper — no DOM side-effects at import time.
 * Applies or removes `data-theme="light"` on <html> based on the resolved theme.
 * Dark is the default (:root), so we only need to SET for light and remove otherwise.
 */
export function applyTheme(theme: Theme, prefersLight: boolean): void {
  const el = document.documentElement
  if (theme === 'light' || (theme === 'system' && prefersLight)) {
    el.setAttribute('data-theme', 'light')
  } else {
    el.removeAttribute('data-theme')
  }
}

/**
 * Reads the stored theme choice, applies it immediately, and (in system mode)
 * listens for OS preference changes. Must be called at the top level of a
 * component tree (App.tsx) so it fires before any frame paints.
 *
 * Hydration gate (VRX-212): the attribute is only touched once the settings
 * store has hydrated. Before then the default :root dark styling stays in place,
 * preventing a system-light preference from flashing over the loading canvas.
 */
export function useApplyTheme(): void {
  const theme = useSettingsStore((s) => s.settings.theme)
  const hydrated = useSettingsStore((s) => s.hydrated)

  // useLayoutEffect (not useEffect) so the theme attribute is set BEFORE the
  // browser paints — otherwise a stored light/system theme flashes dark on first
  // load (CodeRabbit). Safe here: the renderer is client-only, never SSR.
  useLayoutEffect(() => {
    if (!hydrated) return undefined

    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: light)')
        : null

    const prefersLight = mq?.matches ?? false
    applyTheme(theme, prefersLight)

    if (theme === 'system' && mq) {
      const onChange = (e: MediaQueryListEvent): void => applyTheme('system', e.matches)
      mq.addEventListener('change', onChange)
      return (): void => mq.removeEventListener('change', onChange)
    }

    return undefined
  }, [theme, hydrated])
}
