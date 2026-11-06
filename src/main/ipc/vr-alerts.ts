import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { VrOverlayAlerts } from '../vrOverlayAlerts'
import { isTrustedIpcSender } from './security'

/** No renderer input: main writes the test alert and owns where it goes. */
export function registerVrAlertHandlers(alerts: Pick<VrOverlayAlerts, 'test'>): void {
  ipcMain.handle('test-vr-alert', async (event): Promise<IpcInvoke['test-vr-alert']['res']> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    try {
      await alerts.test()
      return { ok: true }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  })
}
