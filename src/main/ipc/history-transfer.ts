import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  HistoryBackupResult,
  HistoryRestoreResult,
  VrcxHistoryImportResult
} from '@shared/historyTransfer'
import { inHistoryTurn } from '../services/historyTransfer'
import { isTrustedIpcSender } from './security'

export interface HistoryTransferHandlerOptions {
  /** Bring VRCX's history in (`vrcxHistoryImport.ts`). */
  importVrcx: () => Promise<VrcxHistoryImportResult>
  /** Whether a backup or a restore can do anything right now. Asked before a
   *  dialog opens, so one never opens for nothing. */
  isKeeping: () => boolean
  /** The native save dialog over the sender's window: the picked path, or
   *  null when cancelled. */
  pickBackupTarget: (event: IpcMainInvokeEvent) => Promise<string | null>
  /** The native open dialog over the sender's window: the picked path, or
   *  null when cancelled. */
  pickBackupSource: (event: IpcMainInvokeEvent) => Promise<string | null>
  backUp: (targetPath: string) => Promise<HistoryBackupResult>
  restore: (sourcePath: string) => Promise<HistoryRestoreResult>
}

/**
 * Moving saved history. No renderer input on any of the three: main reads
 * VRCX's file itself, owns both dialogs and both paths, and answers with
 * counts or a reason. They run one at a time, in the order pressed, so a
 * restore never lands in the middle of an import.
 */
export function registerHistoryTransferHandlers(options: HistoryTransferHandlerOptions): void {
  ipcMain.handle('import-vrcx-history', (event): Promise<VrcxHistoryImportResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return inHistoryTurn(() => options.importVrcx(), { ok: false, reason: 'failed' })
  })

  ipcMain.handle('backup-history', (event): Promise<HistoryBackupResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return inHistoryTurn(
      async (): Promise<HistoryBackupResult> => {
        if (!options.isKeeping()) return { ok: false, reason: 'off' }
        const target = await options.pickBackupTarget(event)
        if (target === null) return { ok: false, reason: 'cancelled' }
        return options.backUp(target)
      },
      { ok: false, reason: 'failed' }
    )
  })

  ipcMain.handle('restore-history', (event): Promise<HistoryRestoreResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return inHistoryTurn(
      async (): Promise<HistoryRestoreResult> => {
        if (!options.isKeeping()) return { ok: false, reason: 'off' }
        const source = await options.pickBackupSource(event)
        if (source === null) return { ok: false, reason: 'cancelled' }
        return options.restore(source)
      },
      { ok: false, reason: 'failed' }
    )
  })
}
