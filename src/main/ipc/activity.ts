import { ipcMain } from 'electron'
import { ACTIVITY_FILTERS, type ActivityEntry } from '@shared/activity'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { ActivityFeed } from '../services/activityFeed'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS: ReadonlySet<unknown> = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_FILTERS: ReadonlySet<unknown> = new Set(ACTIVITY_FILTERS)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Main owns the list. Reading takes no input; Clear names only what the page
 *  shows (one or two platforms and the Show kind), never an entry. */
export function registerActivityHandlers(activity: ActivityFeed): void {
  ipcMain.handle('get-activity', (event): ActivityEntry[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return activity.list()
  })

  ipcMain.handle('clear-activity', (event, req: IpcInvoke['clear-activity']['req']): void => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !isPlainObject(req) ||
      !Array.isArray(req.platforms) ||
      req.platforms.length === 0 ||
      req.platforms.length > 2 ||
      !req.platforms.every((platform) => VALID_PLATFORMS.has(platform)) ||
      !VALID_FILTERS.has(req.filter)
    ) {
      throw new Error('Invalid clear-activity request')
    }
    activity.clear(req.platforms, req.filter)
  })
}
