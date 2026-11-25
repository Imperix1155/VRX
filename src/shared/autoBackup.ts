/**
 * Scheduled local backups (owner, 2026-11-25). Pure values for settings, IPC
 * and the renderer. A path never crosses this module: main keeps the folder.
 */

export const AUTO_BACKUP_INTERVALS = ['daily', '3d', 'weekly'] as const
export type AutoBackupInterval = (typeof AUTO_BACKUP_INTERVALS)[number]
export const AUTO_BACKUP_KEEP_MIN = 1
export const AUTO_BACKUP_KEEP_MAX = 20
export const AUTO_BACKUP_KEEP_DEFAULT = 5

export interface AutoBackupCopy {
  id: string
  createdAt: number
  bytes: number
}

export type AutoBackupProblem = 'failed' | 'folder' | 'integrity'

export interface AutoBackupStatus {
  usingDefaultFolder: boolean
  folderName: string
  lastBackupAt: number | null
  lastError: AutoBackupProblem | null
  copies: AutoBackupCopy[]
}

export type AutoBackupFolderResult =
  | { ok: true; usingDefaultFolder: boolean; folderName: string }
  | { ok: false; reason: 'cancelled' | 'failed' | 'rate-limited' }

export type AutoBackupRestoreResult =
  | { ok: true }
  | { ok: false; reason: 'off' | 'unknown' | 'not-a-backup' | 'newer' | 'failed' | 'rate-limited' }
