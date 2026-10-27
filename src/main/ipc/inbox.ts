import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { InboxService } from '../services/inbox'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS: ReadonlySet<unknown> = new Set<Platform>(['vrchat', 'chilloutvr'])
/** `<kind>:<platform record ID>`, as `InboxService` issues it. */
const MAX_ITEM_ID_LENGTH = 160
const ITEM_ID_PATTERN = /^(invite|invite-request|friend-request):[A-Za-z0-9_:.-]+$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isItemId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_ITEM_ID_LENGTH && ITEM_ID_PATTERN.test(value)
  )
}

/**
 * The view-only inbox. Every action here only changes what VRX shows: nothing
 * reaches either platform, so dismissing never answers or declines anything.
 */
export function registerInboxHandlers(inbox: InboxService): void {
  ipcMain.handle('get-inbox', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return inbox.snapshot()
  })

  ipcMain.handle('dismiss-inbox-item', (event, req: IpcInvoke['dismiss-inbox-item']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!isPlainObject(req) || !VALID_PLATFORMS.has(req.platform) || !isItemId(req.id)) {
      throw new Error('Invalid dismiss-inbox-item request')
    }
    inbox.dismiss(req.platform, req.id)
  })

  ipcMain.handle('clear-inbox', (event, req: IpcInvoke['clear-inbox']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !isPlainObject(req) ||
      !Array.isArray(req.platforms) ||
      req.platforms.length === 0 ||
      req.platforms.length > 2 ||
      !req.platforms.every((platform) => VALID_PLATFORMS.has(platform))
    ) {
      throw new Error('Invalid clear-inbox request')
    }
    inbox.clear(req.platforms)
  })
}
