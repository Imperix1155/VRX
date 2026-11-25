import { ipcMain } from 'electron'
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SEARCH_MAX_LENGTH,
  type ActivityEntry,
  type ActivityFriendRef,
  type ActivityListQuery,
  type ActivityPage,
  type ActivityPageCursor,
  type FriendHistoryFacts
} from '@shared/activity'
import type {
  InstanceVisitCursor,
  InstanceVisitPage,
  InstanceVisitPerson
} from '@shared/instanceLog'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { ActivityFeed } from '../services/activityFeed'
import type { FriendLog } from '../services/friendLog'
import type { InstanceLog } from '../services/instanceLog'
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

/** One or two platforms, each once, each with the time to read before. */
function parseVisitScope(value: unknown): InstanceVisitCursor[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return null
  const scope: InstanceVisitCursor[] = []
  for (const item of value as unknown[]) {
    if (!isPlainObject(item)) return null
    const { platform, before } = item
    if (!VALID_PLATFORMS.has(platform)) return null
    if (scope.some((cursor) => cursor.platform === platform)) return null
    if (before !== null && !(typeof before === 'number' && Number.isSafeInteger(before))) {
      return null
    }
    scope.push({ platform: platform as Platform, before })
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

/** A search and inclusive dates. Absent matches everything. `null` is a bad request. */
function parseListQuery(value: unknown): ActivityListQuery | undefined | null {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) return null
  const { text, from, to } = value
  if (text !== undefined && typeof text !== 'string') return null
  if (typeof text === 'string' && text.trim().length > ACTIVITY_SEARCH_MAX_LENGTH) return null
  const lower = parseBound(from)
  const upper = parseBound(to)
  if (lower === null || upper === null) return null
  const query: ActivityListQuery = {}
  if (typeof text === 'string' && text.trim() !== '') query.text = text.trim()
  if (lower !== undefined) query.from = lower
  if (upper !== undefined) query.to = upper
  return query
}

/** An inclusive moment, or absent. `null` is a bad request. */
function parseBound(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return value
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
export function registerActivityHandlers(
  activity: ActivityFeed,
  friendLog: FriendLog,
  instanceLog: InstanceLog
): void {
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
      const query = isPlainObject(req) ? parseListQuery(req.query) : null
      if (
        !isPlainObject(req) ||
        friends === null ||
        scope === null ||
        query === null ||
        !VALID_FILTERS.has(req.filter)
      ) {
        throw new Error('Invalid get-activity-page request')
      }
      return activity.page({
        scope,
        filter: req.filter,
        ...(friends === undefined ? {} : { friends }),
        ...(query === undefined ||
        (query.text === undefined && query.from === undefined && query.to === undefined)
          ? {}
          : { query })
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
      return friends.map((friend) => ({
        ...friendLog.facts(friend.platform, friend.friendId),
        met: instanceLog.met(friend.platform, friend.friendId)
      }))
    }
  )

  // The instance log: the rooms the signed-in user was in. Main reads it for
  // the accounts signed in right now, never for one the renderer names.
  ipcMain.handle(
    'get-instance-visits',
    (event, req: IpcInvoke['get-instance-visits']['req']): InstanceVisitPage => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const scope = isPlainObject(req) ? parseVisitScope(req.scope) : null
      const query = isPlainObject(req) ? parseListQuery(req.query) : null
      if (scope === null || query === null) throw new Error('Invalid get-instance-visits request')
      return instanceLog.page({
        scope,
        ...(query === undefined ||
        (query.text === undefined && query.from === undefined && query.to === undefined)
          ? {}
          : { query })
      })
    }
  )

  ipcMain.handle(
    'get-instance-visit-people',
    (event, req: IpcInvoke['get-instance-visit-people']['req']): InstanceVisitPerson[] => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      if (
        !isPlainObject(req) ||
        !VALID_PLATFORMS.has(req.platform) ||
        typeof req.visitId !== 'number' ||
        !Number.isSafeInteger(req.visitId) ||
        req.visitId <= 0
      ) {
        throw new Error('Invalid get-instance-visit-people request')
      }
      return instanceLog.people(req.platform, req.visitId)
    }
  )

  ipcMain.handle(
    'clear-instance-log',
    (event, req: IpcInvoke['clear-instance-log']['req']): void => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      if (!isPlainObject(req) || !isPlatformList(req.platforms)) {
        throw new Error('Invalid clear-instance-log request')
      }
      instanceLog.clear(req.platforms)
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
