import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { WorldRatingService } from '../services/worldRatingService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const reference = z.string().min(1).max(128)
const readRequest = z.object({ platform, worldRef: reference }).strict()
const writeRequest = readRequest.extend({ value: z.enum(['like', 'dislike']).nullable() }).strict()

/** The renderer names a world only by the Explore reference main issued. */
export function registerWorldRatingHandlers(service: WorldRatingService): void {
  ipcMain.handle('get-world-rating', (event, req: IpcInvoke['get-world-rating']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = readRequest.parse(req)
    return service.getWorldRating(parsed.platform, parsed.worldRef)
  })
  ipcMain.handle('set-world-rating', (event, req: IpcInvoke['set-world-rating']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = writeRequest.parse(req)
    return service.setWorldRating(parsed.platform, parsed.worldRef, parsed.value)
  })
}
