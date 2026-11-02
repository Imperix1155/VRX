import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Friend, Platform } from '@shared/types'
import type { FriendRoster, IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { RateLimitError, RequestQueueFullError } from '../services/adapters/errors'
import type { AppStatusService } from '../services/appStatus'
import { createFriendRosterReader, type FriendRosterRead } from '../services/friendRoster'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])

/** Encode the roster without changing its rows or the authority that produced it. */
function serializeFriendRoster(
  platform: Platform,
  roster: FriendRoster,
  revision: number
): IpcInvoke['get-friends']['res'] {
  if (platform === 'vrchat') {
    const seeds = roster.seeds ?? [{ revision, friends: roster.friends }]
    return {
      friends: roster.friends,
      completeness: roster.completeness,
      provenance: {
        baseRevision: seeds[0]?.revision ?? revision,
        ...(roster.completeness === 'partial'
          ? { coveredIds: [...new Set(roster.friends.map((friend) => friend.platformUserId))] }
          : {}),
        overrides: seeds.slice(1).map((seed) => ({
          revision: seed.revision,
          friendIds: seed.friends.map((friend) => friend.platformUserId)
        }))
      }
    } satisfies IpcInvoke['get-friends']['res']
  }
  return roster.completeness === 'partial'
    ? { friends: roster.friends, completeness: 'partial' as const }
    : roster.friends
}

export function registerFriendsHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  authority: LocationAuthority,
  appStatus: AppStatusService,
  onRoster?: (platform: Platform, friends: Friend[]) => void
): void {
  const readRoster = createFriendRosterReader(adapters, authority, appStatus, onRoster)
  ipcMain.handle('get-friends', async (event, req: IpcInvoke['get-friends']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) throw new Error('Invalid platform')
    let read: FriendRosterRead
    try {
      read = await readRoster(req.platform)
    } catch (error) {
      // Error properties do not survive Electron's invoke wrapping. Reuse the
      // preload-normalized marker that the query client never retries.
      if (error instanceof RateLimitError || error instanceof RequestQueueFullError) {
        throw new Error('rate_limited', { cause: error })
      }
      throw error
    }
    return serializeFriendRoster(req.platform, read.roster, read.revision)
  })
}
