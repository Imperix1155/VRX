import { ipcMain, shell } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import { isTrustedIpcSender } from './security'
import { isAllowedUrl, isAllowedLaunchUrl } from './url-allowlist'

export function registerLaunchHandlers(): void {
  ipcMain.handle('open-url', async (event, req: IpcInvoke['open-url']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      typeof req.url !== 'string' ||
      (!isAllowedUrl(req.url) && !isAllowedLaunchUrl(req.url))
    ) {
      throw new Error('URL not allowed')
    }
    await shell.openExternal(req.url)
  })
}
