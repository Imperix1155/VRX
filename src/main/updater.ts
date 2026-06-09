/**
 * Auto-update wiring (VRX-11)
 *
 * Wires electron-updater to GitHub Releases (provider configured in
 * electron-builder.yml). Checks once on startup and shows the OS notification
 * when an update is downloaded. No-ops outside a packaged build — there is
 * nothing to update against in dev / preview.
 */
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import log from './logger'

// electron-updater is CommonJS; destructure from the default import so the
// named export resolves under electron-vite's ESM main build.
const { autoUpdater } = electronUpdater

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.logger = log
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.warn('autoUpdater: update check failed', err)
  })
}
