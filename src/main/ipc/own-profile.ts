import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  OWN_BIO_MAX_LENGTH,
  OWN_PRONOUNS_MAX_LENGTH,
  OWN_STATUSES,
  OWN_STATUS_TEXT_MAX_LENGTH
} from '@shared/ownProfile'
import type { IpcInvoke } from '@shared/ipc'
import type { OwnProfileService } from '../services/ownProfileService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const profileRequest = z.object({ platform }).strict()
// Shape and an outer length bound only; the service normalizes the text,
// checks each platform editor's limit, and refuses status on ChilloutVR.
const saveRequest = z
  .object({
    platform,
    changes: z
      .object({
        bio: z
          .string()
          .max(OWN_BIO_MAX_LENGTH * 2)
          .optional(),
        pronouns: z
          .string()
          .max(OWN_PRONOUNS_MAX_LENGTH * 2)
          .optional(),
        status: z.enum(OWN_STATUSES).optional(),
        statusText: z
          .string()
          .max(OWN_STATUS_TEXT_MAX_LENGTH * 2)
          .optional()
      })
      .strict()
  })
  .strict()

/** The renderer names a platform and, for a Save, the changed fields; main
 *  owns the account, the request and the one-Save-at-a-time rule. */
export function registerOwnProfileHandlers(service: OwnProfileService): void {
  ipcMain.handle('get-own-profile', (event, req: IpcInvoke['get-own-profile']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = profileRequest.parse(req)
    return service.getOwnProfile(parsed.platform)
  })
  ipcMain.handle('save-own-profile', (event, req: IpcInvoke['save-own-profile']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = saveRequest.safeParse(req)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    return service.saveOwnProfile(parsed.data.platform, parsed.data.changes)
  })
}
