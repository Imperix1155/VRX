import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

export function registerFriendsHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  authority: LocationAuthority
): void {
  ipcMain.handle('get-friends', async (event, req: IpcInvoke['get-friends']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid platform')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const revision = authority.captureSeedRevision(req.platform)
    const friends = await adapter.getFriends()
    authority.seed(req.platform, friends, revision)
    return friends
  })
}
