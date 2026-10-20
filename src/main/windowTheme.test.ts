/**
 * windowTheme.test.ts: the native chrome follows the Theme setting. Electron is
 * mocked with just nativeTheme and BrowserWindow.getAllWindows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, () => void>()
  const nativeTheme = {
    themeSource: 'system' as string,
    shouldUseDarkColors: true,
    on: (event: string, cb: () => void) => listeners.set(event, cb)
  }
  const windows: { isDestroyed: () => boolean; setBackgroundColor: ReturnType<typeof vi.fn> }[] = []
  return { listeners, nativeTheme, windows }
})
vi.mock('electron', () => ({
  nativeTheme: electron.nativeTheme,
  BrowserWindow: { getAllWindows: () => electron.windows }
}))
vi.mock('./logger', () => ({ default: { warn: vi.fn() } }))

import {
  WINDOW_BACKGROUND,
  applyWindowTheme,
  watchSystemTheme,
  windowBackgroundColor
} from './windowTheme'

const addWindow = (destroyed = false): ReturnType<typeof vi.fn> => {
  const setBackgroundColor = vi.fn()
  electron.windows.push({ isDestroyed: () => destroyed, setBackgroundColor })
  return setBackgroundColor
}

beforeEach(() => {
  electron.windows.length = 0
  electron.listeners.clear()
  electron.nativeTheme.themeSource = 'system'
  electron.nativeTheme.shouldUseDarkColors = true
})

describe('windowTheme', () => {
  it('picks the canvas color for the resolved theme', () => {
    expect(windowBackgroundColor()).toBe(WINDOW_BACKGROUND.dark)
    electron.nativeTheme.shouldUseDarkColors = false
    expect(windowBackgroundColor()).toBe(WINDOW_BACKGROUND.light)
  })

  it('sets the theme source and repaints every live window', () => {
    const live = addWindow()
    const gone = addWindow(true)
    electron.nativeTheme.shouldUseDarkColors = false
    applyWindowTheme('light')
    expect(electron.nativeTheme.themeSource).toBe('light')
    expect(live).toHaveBeenCalledWith(WINDOW_BACKGROUND.light)
    expect(gone).not.toHaveBeenCalled()
  })

  it('never throws, so a settings save cannot fail on it', () => {
    electron.windows.push({
      isDestroyed: () => false,
      setBackgroundColor: vi.fn(() => {
        throw new Error('boom')
      })
    })
    expect(() => applyWindowTheme('dark')).not.toThrow()
  })

  it('repaints when the OS switches while the theme is System', () => {
    const live = addWindow()
    watchSystemTheme()
    electron.nativeTheme.shouldUseDarkColors = false
    electron.listeners.get('updated')?.()
    expect(live).toHaveBeenCalledWith(WINDOW_BACKGROUND.light)
  })
})
