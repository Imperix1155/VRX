import { ipcMain } from 'electron'
import {
  ACTIVITY_FILTERS,
  type ActivityEntry,
  type ActivityFriendRef,
  type ActivityPage,
  type ActivityPageCursor,
  type FriendHistoryFacts
} from '@shared/activity'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { ActivityFeed } from '../services/activityFeed'
import type { FriendLog } from '../services/friendLog'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS: ReadonlySet<unknown> = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_FILTERS: ReadonlySet<unknown> = new Set(ACTIVITY_FILTERS)
const MAX_FRIEND_ID_LENGTH = 128
const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function isPlatformList(value: unknown): value is Platform[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    value.every((platform) => VALID_PLATFORMS.has(platform))
  )
}

/** One or two platforms, each once, each with the entry id to read before. */
function parseScope(value: unknown): ActivityPageCursor[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return null
  const scope: ActivityPageCursor[] = []
  for (const item of value as unknown[]) {
    if (!isPlainObject(item)) return null
    const { platform, beforeId } = item
    if (!VALID_PLATFORMS.has(platform)) return null
    if (scope.some((cursor) => cursor.platform === platform)) return null
    if (
      beforeId !== null &&
      !(typeof beforeId === 'number' && Number.isSafeInteger(beforeId) && beforeId > 0)
    ) {
      return null
    }
    scope.push({ platform: platform as Platform, beforeId })
  }
  return scope
}

/** One friend, or a linked person's two accounts: a platform and a bounded id. */
function parseFriends(value: unknown): ActivityFriendRef[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return null
  const friends: ActivityFriendRef[] = []
  for (const item of value as unknown[]) {
    if (!isPlainObject(item)) return null
    const { platform, friendId } = item
    if (
      !VALID_PLATFORMS.has(platform) ||
      typeof friendId !== 'string' ||
      friendId.length === 0 ||
      friendId.length > MAX_FRIEND_ID_LENGTH ||
      !FRIEND_ID_PATTERN.test(friendId)
    ) {
      return null
    }
    friends.push({ platform: platform as Platform, friendId })
  }
  return friends
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Main owns the list. Reading the newest takes no input; a page names a
 *  scope (each platform and the entry id to read before, a kind, friends) and main reads
 *  it for the accounts signed in right now, never for one the renderer names.
 *  Clear names only what the page shows (one or two platforms and the Show
 *  kind), never an entry. */
export function registerActivityHandlers(activity: ActivityFeed, friendLog: FriendLog): void {
  ipcMain.handle('get-activity', (event): ActivityEntry[] => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return activity.list()
  })

  ipcMain.handle(
    'get-activity-page',
    (event, req: IpcInvoke['get-activity-page']['req']): ActivityPage => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const friends = isPlainObject(req) ? parseFriends(req.friends) : null
      const scope = isPlainObject(req) ? parseScope(req.scope) : null
      if (
        !isPlainObject(req) ||
        friends === null ||
        scope === null ||
        !VALID_FILTERS.has(req.filter)
      ) {
        throw new Error('Invalid get-activity-page request')
      }
      return activity.page({
        scope,
        filter: req.filter,
        ...(friends === undefined ? {} : { friends })
      })
    }
  )

  // What is saved about one friendship (or a linked person's two): read
  // from VRX's own file for the accounts signed in right now.
  ipcMain.handle(
    'get-friend-history',
    (event, req: IpcInvoke['get-friend-history']['req']): FriendHistoryFacts[] => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const friends = isPlainObject(req) ? parseFriends(req.friends) : null
      if (friends === null || friends === undefined) {
        throw new Error('Invalid get-friend-history request')
      }
      return friends.map((friend) => friendLog.facts(friend.platform, friend.friendId))
    }
  )

  ipcMain.handle('clear-activity', (event, req: IpcInvoke['clear-activity']['req']): void => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!isPlainObject(req) || !isPlatformList(req.platforms) || !VALID_FILTERS.has(req.filter)) {
      throw new Error('Invalid clear-activity request')
    }
    activity.clear(req.platforms, req.filter)
  })
}
