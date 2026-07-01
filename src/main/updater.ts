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

// electron-updater exports `autoUpdater` as a lazy getter, which a static ESM
// named import can't bind (it resolves to undefined). Destructure it from the
// default import so it works whether the main bundle is CJS (current) or ESM.
const { autoUpdater } = electronUpdater

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.logger = log
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    // Reformat to a plain string: Error.message/.stack are non-enumerable, so the
    // log redaction hook's object-walk can't see inside a raw Error (house pattern —
    // see the crash handlers in index.ts).
    log.warn('autoUpdater: update check failed', err instanceof Error ? err.message : String(err))
  })
}
