/**
 * System tray (VRX-112).
 *
 * `buildTrayMenuTemplate` is pure — plain args in, a Menu template out — so the
 * label/ordering logic is unit-testable without electron. `createTray` does the
 * actual Tray/Menu/nativeImage wiring and is called once from index.ts on
 * whenReady.
 */
import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import icon from '../../resources/icon.png?asset'

export interface TrayMenuCallbacks {
  isVisible: boolean
  onShow: () => void
  onHide: () => void
  onQuit: () => void
}

export function buildTrayMenuTemplate({
  isVisible,
  onShow,
  onHide,
  onQuit
}: TrayMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    isVisible ? { label: 'Hide VRX', click: onHide } : { label: 'Show VRX', click: onShow },
    { type: 'separator' },
    { label: 'Quit VRX', click: onQuit }
  ]
}

export interface TrayHandle {
  tray: Tray
  /** Attach menu-refresh listeners to a (re)created window and sync the menu.
   *  Call for EVERY window the app creates — macOS destroys the window on
   *  close and `activate` makes a new one; without rewiring, the menu label
   *  would go stale (Codex review, PR #118). */
  wireWindow: (win: Electron.BrowserWindow) => void
}

/**
 * `getWindow` resolves the CURRENT main window at CLICK TIME — the callbacks
 * deliberately never close over a window instance, because on macOS the bound
 * window can be destroyed and replaced (native close + dock activate); a
 * captured reference would leave every tray action a silent no-op (Codex
 * review, PR #118). Null/destroyed → the action no-ops safely.
 */
export function createTray(getWindow: () => Electron.BrowserWindow | null): TrayHandle {
  // macOS tray icons render at their source size — a 512px app icon would fill
  // the whole menu bar, so shrink to the conventional 16x16 tray size there.
  // Windows/Linux tray icons are fine at a larger size, so only macOS resizes.
  const trayIcon = nativeImage.createFromPath(icon)
  const image =
    process.platform === 'darwin' ? trayIcon.resize({ width: 16, height: 16 }) : trayIcon

  const tray = new Tray(image)
  tray.setToolTip('VRX')

  const live = (): Electron.BrowserWindow | null => {
    const win = getWindow()
    return win && !win.isDestroyed() ? win : null
  }

  const showCurrent = (): void => {
    const win = live()
    if (win) {
      win.show()
      win.focus()
    }
  }

  const refreshMenu = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate({
          isVisible: live()?.isVisible() ?? false,
          onShow: showCurrent,
          onHide: () => live()?.hide(),
          onQuit: () => {
            app.quit()
          }
        })
      )
    )
  }

  const wireWindow = (win: Electron.BrowserWindow): void => {
    win.on('show', refreshMenu)
    win.on('hide', refreshMenu)
    refreshMenu()
  }

  tray.on('double-click', showCurrent)

  return { tray, wireWindow }
}
