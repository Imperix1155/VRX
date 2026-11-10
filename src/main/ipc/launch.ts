import { app, ipcMain, shell } from 'electron'
import { arch, release } from 'node:os'
import { dirname } from 'node:path'
import { getLogFilePath } from '../logger'
import { buildBugReportUrl } from '../services/bugReport'
import type { IpcInvoke } from '@shared/ipc'
import { isTrustedIpcSender } from './security'
import { isAllowedUrl } from './url-allowlist'

/** A second press this soon after the first opens nothing more (a double click). */
export const OPEN_REPEAT_MS = 2_000

export function registerLaunchHandlers(clock: () => number = () => performance.now()): void {
  const lastOpened = new Map<'logs' | 'bug-report', number>()
  /** True for the first press; false for a repeat inside OPEN_REPEAT_MS. */
  const firstPress = (what: 'logs' | 'bug-report'): boolean => {
    const now = clock()
    const last = lastOpened.get(what)
    if (last !== undefined && now - last < OPEN_REPEAT_MS) return false
    lastOpened.set(what, now)
    return true
  }

  ipcMain.handle('open-url', async (event, req: IpcInvoke['open-url']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || typeof req.url !== 'string' || !isAllowedUrl(req.url)) {
      throw new Error('URL not allowed')
    }
    await shell.openExternal(req.url)
  })

  // No renderer input: the folder is always the logger's own directory.
  ipcMain.handle('open-logs-folder', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const logFile = getLogFilePath()
    if (logFile === '') throw new Error('Log file unavailable')
    if (!firstPress('logs')) return
    const failure = await shell.openPath(dirname(logFile))
    if (failure !== '') throw new Error('Could not open logs folder')
  })

  // No renderer input: main builds the whole link from its own facts.
  ipcMain.handle('open-bug-report', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const url = buildBugReportUrl({
      version: app.getVersion(),
      platform: process.platform,
      release: release(),
      arch: arch(),
      packaged: app.isPackaged,
      portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
      appImage: !!process.env.APPIMAGE
    })
    if (!isAllowedUrl(url)) throw new Error('URL not allowed')
    if (!firstPress('bug-report')) return
    await shell.openExternal(url)
  })
}
