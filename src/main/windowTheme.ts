import { BrowserWindow, nativeTheme } from 'electron'
import type { Theme } from '@shared/types'
import log from './logger'

/** The renderer's `--bg-base` per theme, painted before and around the page. */
export const WINDOW_BACKGROUND = { dark: '#08080b', light: '#eef3f8' } as const

/** Window background for the theme Electron currently resolves. */
export function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/**
 * Make the native chrome follow the saved Theme preference: the title bar and
 * native menus switch with it, and every window's background matches the app
 * canvas so a resize or reload never flashes white. `system` keeps following
 * the OS. Best-effort: a failure here must never fail a settings save.
 */
export function applyWindowTheme(theme: Theme): void {
  try {
    nativeTheme.themeSource = theme
    const color = windowBackgroundColor()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(color)
    }
  } catch (error) {
    log.warn('window theme sync failed', { error: String(error) })
  }
}

/** Keep `system` windows matched when the OS switches between light and dark. */
export function watchSystemTheme(): void {
  nativeTheme.on('updated', () => {
    const color = windowBackgroundColor()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(color)
    }
  })
}
