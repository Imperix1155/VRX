import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { AvatarLibraryService } from '../services/avatarLibraryService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const libraryRequest = z.object({ platform }).strict()
// Shape only; the service accepts an ID only when it listed that avatar itself.
const avatarRequest = z.object({ platform, avatarId: z.string().min(1).max(64) }).strict()

/** The renderer names a platform and an avatar main listed; main owns every request. */
export function registerAvatarLibraryHandlers(service: AvatarLibraryService): void {
  ipcMain.handle('get-avatar-library', (event, req: IpcInvoke['get-avatar-library']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = libraryRequest.parse(req)
    return service.getLibrary(parsed.platform)
  })
  ipcMain.handle('get-avatar-details', (event, req: IpcInvoke['get-avatar-details']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = avatarRequest.parse(req)
    return service.getDetails(parsed.platform, parsed.avatarId)
  })
  ipcMain.handle('switch-avatar', (event, req: IpcInvoke['switch-avatar']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = avatarRequest.parse(req)
    return service.switchAvatar(parsed.platform, parsed.avatarId)
  })
}
