import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { FriendRoster, IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { RateLimitError, RequestQueueFullError } from '../services/adapters/errors'
import type { AppStatusService } from '../services/appStatus'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

export function registerFriendsHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  authority: LocationAuthority,
  appStatus: AppStatusService
): void {
  ipcMain.handle('get-friends', async (event, req: IpcInvoke['get-friends']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid platform')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const revision = authority.captureSeedRevision(req.platform)
    let roster: FriendRoster
    try {
      roster = await adapter.getFriends()
    } catch (error) {
      // Error properties do not survive Electron's invoke wrapping. Reuse the
      // preload-normalized marker that the query client never retries.
      if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
        throw new Error('rate_limited')
      }
      throw error
    }
    authority.seed(req.platform, roster.friends, revision, roster.completeness)
    appStatus.recordReconcile(req.platform)
    return roster.completeness === 'partial'
      ? { friends: roster.friends, completeness: 'partial' as const }
      : roster.friends
  })
}
