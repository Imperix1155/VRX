import { ipcMain } from 'electron'
import { z } from 'zod'
import { SOCIAL_ACTIONS } from '@shared/socialActions'
import type { IpcInvoke } from '@shared/ipc'
import type { SocialActionService } from '../services/socialActionService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
// Shape only; the service acts only on a friend or a searched person.
const personRequest = z.object({ platform, userId: z.string().min(1).max(64) }).strict()
const actionRequest = z
  .object({ platform, userId: z.string().min(1).max(64), action: z.enum(SOCIAL_ACTIONS) })
  .strict()

/** The profile's Unfriend, Block and Unblock: one person and one action per
 *  call. Main owns the session, the person check and the pause between actions. */
export function registerSocialHandlers(service: SocialActionService): void {
  ipcMain.handle('get-relationship', (event, req: IpcInvoke['get-relationship']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = personRequest.parse(req)
    return service.getRelationship(parsed.platform, parsed.userId)
  })
  ipcMain.handle('social-action', (event, req: IpcInvoke['social-action']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = actionRequest.parse(req)
    return service.act(parsed.platform, parsed.userId, parsed.action)
  })
}
