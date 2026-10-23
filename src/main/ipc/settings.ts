import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import {
  getSettingsSnapshot,
  hasPendingSettingsSave,
  loadSettingsForRenderer,
  saveSettings
} from '../services/settings'
import { isTrustedIpcSender } from './security'

/**
 * Settings persistence channels (VRX-184). Thin wiring over
 * `services/settings.ts` — schema validation, migrations, and the
 * newer-version rollback guard all live there / in `@shared/settings`.
 * `save-settings` settles after main's coalesced disk write and propagates a
 * newer-version refusal or write failure as a rejected invoke (the renderer
 * leaves the store dirty and carries on in-memory).
 *
 * `onApplied` sees the in-memory settings after every save attempt, so main
 * process state that mirrors a setting (the native window theme) follows it.
 */
export function registerSettingsHandlers(onApplied?: (settings: Settings) => void): void {
  ipcMain.handle('get-settings', (event): IpcInvoke['get-settings']['res'] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const settings = loadSettingsForRenderer()
    return hasPendingSettingsSave() ? { ...settings, unsaved: true } : settings
  })

  ipcMain.handle(
    'save-settings',
    (event, req: IpcInvoke['save-settings']['req']): Promise<Settings> => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      // Shape-validate before use (the W3 pattern): the patch must be a plain
      // object — spreading a string/array would smear indices into the store.
      // Field-level validation is parseSettings' job inside saveSettings.
      const patch = req?.patch
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        throw new Error('save-settings: patch must be an object')
      }
      try {
        return saveSettings(patch)
      } finally {
        // saveSettings applies the patch in memory before touching disk, so it
        // is live even when the write is refused or fails.
        onApplied?.(getSettingsSnapshot())
      }
    }
  )
}
