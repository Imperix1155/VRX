import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import { loadSettings, saveSettings } from '../services/settings'
import { isTrustedIpcSender } from './security'

/**
 * Settings persistence channels (VRX-184). Thin wiring over
 * `services/settings.ts` — schema validation, migrations, and the
 * newer-version rollback guard all live there / in `@shared/settings`.
 * `save-settings` intentionally propagates the service's newer-version
 * refusal as a rejected invoke (the renderer leaves the store dirty and
 * carries on in-memory).
 */
export function registerSettingsHandlers(): void {
  ipcMain.handle('get-settings', (event): Settings => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return loadSettings()
  })

  ipcMain.handle('save-settings', (event, req: IpcInvoke['save-settings']['req']): Settings => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    // Shape-validate before use (the W3 pattern): the patch must be a plain
    // object — spreading a string/array would smear indices into the store.
    // Field-level validation is parseSettings' job inside saveSettings.
    const patch = req?.patch
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new Error('save-settings: patch must be an object')
    }
    return saveSettings(patch)
  })
}
