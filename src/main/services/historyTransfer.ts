/**
 * Back up and restore the saved history (owner, 2026-11-15), for moving to a
 * new computer. A backup is one file holding everything `history.sqlite3`
 * holds, for every account that used VRX here. Restoring replaces what is
 * saved with the file's rows; nothing is merged.
 *
 * Main owns the dialogs and the paths. The picked file is never changed: a
 * restore reads a private copy, and a backup is written beside nothing else.
 * Nothing is sent anywhere.
 */
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryBackupResult, HistoryRestoreResult } from '@shared/historyTransfer'
import type { HistoryDatabase } from './historyDatabase'

/** The largest file a restore reads. */
export const MAX_HISTORY_BACKUP_BYTES = 4 * 1024 ** 3

const WORK_FILE = 'history.sqlite3'

export interface HistoryTransferOptions {
  database: HistoryDatabase
  /** Whether activity is being saved at all. */
  isKeeping: () => boolean
  /** A folder private to this user for the working copy (the temp folder). */
  workDirectory: () => string
  /** Everything in memory starts over from the restored rows. */
  afterRestore: () => void
}

/** The name a backup is offered under: `vrx-history-2026-11-15.sqlite3`. */
export function historyBackupFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `vrx-history-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.sqlite3`
}

/** Write a backup to `targetPath`, replacing a file already there (the save
 *  dialog asked). */
export async function backUpHistory(
  options: HistoryTransferOptions,
  targetPath: string
): Promise<HistoryBackupResult> {
  if (!options.isKeeping() || options.database.storage !== 'file') {
    return { ok: false, reason: 'off' }
  }
  let work: string | null = null
  try {
    work = await mkdtemp(join(options.workDirectory(), 'vrx-history-'))
    const copy = join(work, WORK_FILE)
    if (!options.database.backupTo(copy)) return { ok: false, reason: 'failed' }
    await copyFile(copy, targetPath)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  } finally {
    if (work !== null) await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Replace the saved history with the backup at `sourcePath`. */
export async function restoreHistory(
  options: HistoryTransferOptions,
  sourcePath: string
): Promise<HistoryRestoreResult> {
  if (!options.isKeeping() || options.database.storage !== 'file') {
    return { ok: false, reason: 'off' }
  }
  let work: string | null = null
  try {
    const source = await stat(sourcePath)
    if (!source.isFile() || source.size <= 0 || source.size > MAX_HISTORY_BACKUP_BYTES) {
      return { ok: false, reason: 'not-a-backup' }
    }
    work = await mkdtemp(join(options.workDirectory(), 'vrx-history-'))
    const copy = join(work, WORK_FILE)
    await copyFile(sourcePath, copy)
    // The setting may have changed while the file was being copied.
    if (!options.isKeeping()) return { ok: false, reason: 'off' }
    const outcome = options.database.restoreFrom(copy)
    if (outcome !== 'restored') return { ok: false, reason: outcome }
    options.afterRestore()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  } finally {
    if (work !== null) await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}
