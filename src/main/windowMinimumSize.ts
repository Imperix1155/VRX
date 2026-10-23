import { screen, type BrowserWindow } from 'electron'

/** The shipped default page size, which is also the floor (VRX-243). */
export const WINDOW_MIN_WIDTH = 900
export const WINDOW_MIN_HEIGHT = 670

type Size = { width: number; height: number }

/**
 * The outer-window floor that keeps the page at 900x670, clamped to a
 * display's work area. The window is sized by its content
 * (`useContentSize`), but `setMinimumSize` takes the outer size, so the
 * frame (title bar and borders) is added back. Electron does not clamp
 * minimum sizes itself, so an unclamped floor on a small or DPI-scaled
 * display (e.g. 1366x768 at 125%) leaves the window bottom permanently
 * off-screen.
 */
export function minimumSizeFor(
  workArea: Size,
  frame: Size = { width: 0, height: 0 }
): [number, number] {
  return [
    Math.min(WINDOW_MIN_WIDTH + frame.width, workArea.width),
    Math.min(WINDOW_MIN_HEIGHT + frame.height, workArea.height)
  ]
}

/** The window's frame: its outer size minus its page size. */
function frameOf(window: BrowserWindow): Size {
  const outer = window.getBounds()
  const content = window.getContentBounds()
  return {
    width: Math.max(0, outer.width - content.width),
    height: Math.max(0, outer.height - content.height)
  }
}

/**
 * Keep the window's floor clamped to the display it is on now, not only the
 * primary display at creation: moving VRX to a smaller laptop screen, or a
 * resolution change, must not leave part of it unreachable. Applied once
 * right away too, so the floor is in outer-window terms from the start.
 */
export function keepMinimumSizeOnScreen(window: BrowserWindow): void {
  const clamp = (): void => {
    // A minimized window's bounds say nothing about its frame.
    if (window.isDestroyed() || window.isMinimized()) return
    const { workAreaSize } = screen.getDisplayMatching(window.getBounds())
    const [width, height] = minimumSizeFor(workAreaSize, frameOf(window))
    window.setMinimumSize(width, height)
  }
  clamp()
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
