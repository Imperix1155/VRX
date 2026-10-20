import { screen, type BrowserWindow } from 'electron'

/** The shipped default window size, which is also the floor (VRX-243). */
export const WINDOW_MIN_WIDTH = 900
export const WINDOW_MIN_HEIGHT = 670

/**
 * The floor clamped to a display's work area. Electron does not clamp minimum
 * sizes itself, so an unclamped 670 floor on a small or DPI-scaled display
 * (e.g. 1366x768 at 125%) leaves the window bottom permanently off-screen.
 */
export function minimumSizeFor(workArea: { width: number; height: number }): [number, number] {
  return [Math.min(WINDOW_MIN_WIDTH, workArea.width), Math.min(WINDOW_MIN_HEIGHT, workArea.height)]
}

/**
 * Keep the window's floor clamped to the display it is on now, not only the
 * primary display at creation: moving VRX to a smaller laptop screen, or a
 * resolution change, must not leave part of it unreachable.
 */
export function keepMinimumSizeOnScreen(window: BrowserWindow): void {
  const clamp = (): void => {
    if (window.isDestroyed()) return
    const { workAreaSize } = screen.getDisplayMatching(window.getBounds())
    const [width, height] = minimumSizeFor(workAreaSize)
    window.setMinimumSize(width, height)
  }
  // 'move', not 'moved': 'moved' never fires on Linux. The clamp is cheap.
  window.on('move', clamp)
  screen.on('display-metrics-changed', clamp)
  screen.on('display-removed', clamp)
  screen.on('display-added', clamp)
  window.once('closed', () => {
    screen.removeListener('display-metrics-changed', clamp)
    screen.removeListener('display-removed', clamp)
    screen.removeListener('display-added', clamp)
  })
}
