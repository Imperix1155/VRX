import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { FriendActionsService } from '../services/friendActions'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
// Shape only: the service answers only a friend request row it holds itself.
const answerRequest = z
  .object({
    platform,
    id: z
      .string()
      .max(160)
      .regex(/^friend-request:[A-Za-z0-9_:.-]+$/),
    answer: z.enum(['accept', 'decline'])
  })
  .strict()
// Shape only: the service sends only to someone a search listed this session.
const sendRequest = z.object({ platform, userId: z.string().min(1).max(64) }).strict()

/**
 * Friend actions: one press, one write. The renderer names an inbox row or a
 * listed person; main decides whether and what to send.
 */
export function registerFriendActionHandlers(service: FriendActionsService): void {
  ipcMain.handle(
    'answer-friend-request',
    (event, req: IpcInvoke['answer-friend-request']['req']) => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const parsed = answerRequest.parse(req)
      return service.answer(parsed.platform, parsed.id, parsed.answer)
    }
  )
  ipcMain.handle('send-friend-request', (event, req: IpcInvoke['send-friend-request']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = sendRequest.parse(req)
    return service.send(parsed.platform, parsed.userId)
  })
}
