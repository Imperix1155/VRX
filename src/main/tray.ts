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

export function createTray(mainWindow: Electron.BrowserWindow): Tray {
  // macOS tray icons render at their source size — a 512px app icon would fill
  // the whole menu bar, so shrink to the conventional 16x16 tray size there.
  // Windows/Linux tray icons are fine at a larger size, so only macOS resizes.
  const trayIcon = nativeImage.createFromPath(icon)
  const image =
    process.platform === 'darwin' ? trayIcon.resize({ width: 16, height: 16 }) : trayIcon

  const tray = new Tray(image)
  tray.setToolTip('VRX')

  const refreshMenu = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate({
          isVisible: mainWindow.isVisible(),
          onShow: () => {
            if (!mainWindow.isDestroyed()) {
              mainWindow.show()
              mainWindow.focus()
            }
          },
          onHide: () => {
            if (!mainWindow.isDestroyed()) mainWindow.hide()
          },
          onQuit: () => {
            app.quit()
          }
        })
      )
    )
  }

  mainWindow.on('show', refreshMenu)
  mainWindow.on('hide', refreshMenu)
  refreshMenu()

  tray.on('double-click', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  return tray
}
