import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  AutoBackupFolderResult,
  AutoBackupRestoreResult,
  AutoBackupStatus
} from '@shared/autoBackup'
import { isBackupId } from '../services/autoBackup'
import { isTrustedIpcSender } from './security'

export interface AutoBackupHandlerOptions {
  status: () => Promise<AutoBackupStatus>
  /** The native folder dialog over the sender's window. Null when cancelled. */
  pickFolder: (event: IpcMainInvokeEvent) => Promise<string | null>
  /** `null` returns to VRX's own folder. A path never goes back to the renderer. */
  setDirectory: (absolutePath: string | null) => Promise<AutoBackupFolderResult>
  restore: (id: string) => Promise<AutoBackupRestoreResult>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** The backup's directory name only. A slash, `..`, or any other field is refused. */
function restoreId(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'id' || !Object.hasOwn(raw, 'id')) return null
  const id = raw.id
  if (typeof id !== 'string') return null
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return null
  return isBackupId(id) ? id : null
}

/**
 * Scheduled local backups. The renderer never sends or receives a path.
 * Main owns the folder dialog and answers with a name or a reason.
 */
export function registerAutoBackupHandlers(options: AutoBackupHandlerOptions): void {
  ipcMain.handle('get-auto-backup', (event): Promise<AutoBackupStatus> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return options.status()
  })

  ipcMain.handle('choose-auto-backup-folder', (event): Promise<AutoBackupFolderResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return (async (): Promise<AutoBackupFolderResult> => {
      const picked = await options.pickFolder(event)
      if (picked === null) return { ok: false, reason: 'cancelled' }
      return options.setDirectory(picked)
    })()
  })

  ipcMain.handle(
    'reset-auto-backup-folder',
    async (event): Promise<{ usingDefaultFolder: true; folderName: 'backups' }> => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      await options.setDirectory(null)
      return { usingDefaultFolder: true, folderName: 'backups' }
    }
  )

  ipcMain.handle('restore-auto-backup', (event, req: unknown): Promise<AutoBackupRestoreResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const id = restoreId(req)
    if (id === null) return Promise.resolve({ ok: false, reason: 'unknown' })
    return options.restore(id)
  })
}
