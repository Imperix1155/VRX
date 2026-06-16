import { ipcMain } from 'electron'
import type { AppStatus } from '@shared/types'
import { isTrustedIpcSender } from './security'

// WS/REST health tracking lives in VRX-79/146/147. Until those land, report 'ok'
// so the dashboard has a handler to call without crashing.
const STUB_STATUS: AppStatus = {
  ws: { vrchat: 'ok', chilloutvr: 'ok' },
  rest: { vrchat: 'ok', chilloutvr: 'ok' },
  network: true,
  lastReconcileAt: null
}

export function registerAppStatusHandlers(): void {
  ipcMain.handle('get-app-status', (event): AppStatus => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return STUB_STATUS
  })
}
