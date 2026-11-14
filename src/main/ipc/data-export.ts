import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DataExportResult } from '@shared/ipc'
import {
  buildDataExport,
  dataExportFileName,
  serializeDataExport,
  type DataExportSources
} from '../services/dataExport'
import { isTrustedIpcSender } from './security'

export interface DataExportHandlerOptions {
  sources: DataExportSources
  /**
   * Main's own mark for the sessions signed in right now: one session epoch
   * per platform, never an account id. Read when Export is pressed and again
   * after `prepare`, so a file is only ever built for the accounts it was
   * pressed under.
   */
  sessions: () => string
  /**
   * Show the native save dialog over the sender's window and write `content`
   * to the file the user picks. False when the dialog was cancelled; throws
   * when the file could not be written.
   */
  saveFile: (event: IpcMainInvokeEvent, suggestedName: string, content: string) => Promise<boolean>
  /**
   * Runs once an export is known to be possible, before the file is built:
   * waits for the once-per-sign-in favorites read. Never a refresh, never a
   * write, and bounded in time by the caller.
   */
  prepare?: () => Promise<void>
}

/**
 * Export friends, notes and favorites. No renderer input: main builds the
 * file from what it already holds, owns the dialog and the path, and answers
 * with counts only. The one thing it may wait for is the favorites read VRX
 * makes once per sign-in anyway (`prepare`); a session that changes during
 * that wait gets `stale` and no dialog.
 */
export function registerDataExportHandlers(options: DataExportHandlerOptions): void {
  // One dialog at a time: a second press while it is open joins the first.
  let saving: Promise<DataExportResult> | null = null

  ipcMain.handle('export-data', (event): Promise<DataExportResult> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (saving) return saving
    const run = (async (): Promise<DataExportResult> => {
      try {
        const pressedUnder = options.sessions()
        // Refuse first, so a signed-out or still-loading app starts no read.
        const ready = buildDataExport(options.sources)
        if (!ready.ok) return ready
        await options.prepare?.().catch(() => undefined)
        // A sign-in or sign-out during the wait ends this export: the next
        // press starts over. Nothing waits between this check and the build,
        // and the dialog saves the text built here.
        if (options.sessions() !== pressedUnder) return { ok: false, reason: 'stale' }
        const built = buildDataExport(options.sources)
        if (!built.ok) return built
        const name = dataExportFileName(options.sources.now())
        const saved = await options.saveFile(event, name, serializeDataExport(built.file))
        if (!saved) return { ok: false, reason: 'cancelled' }
        return { ok: true, ...built.counts, gameFavoritesMissing: built.gameFavoritesMissing }
      } catch {
        return { ok: false, reason: 'save-failed' }
      }
    })()
    saving = run
    void run.finally(() => {
      if (saving === run) saving = null
    })
    return run
  })
}
