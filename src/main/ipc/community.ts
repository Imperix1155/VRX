import { ipcMain } from 'electron'
import { z } from 'zod'
import { COMMUNITY_QUERY_MAX_LENGTH, WORLD_LISTS } from '@shared/community'
import type { IpcInvoke } from '@shared/ipc'
import type { CommunityService } from '../services/communityService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const platformRequest = z.object({ platform }).strict()
// Shape only; the service reads a profile only for a friend or a searched person.
const personRequest = z.object({ platform, userId: z.string().min(1).max(64) }).strict()
// The service trims and checks the length again before anything is sent.
const searchRequest = z
  .object({ platform, query: z.string().max(COMMUNITY_QUERY_MAX_LENGTH * 4) })
  .strict()
const listRequest = z
  .object({ platform, list: z.enum(WORLD_LISTS), refresh: z.boolean().optional() })
  .strict()
const groupsRequest = z.object({ platform, refresh: z.boolean().optional() }).strict()

/** Read-only lookups. The renderer names a platform and, at most, a person or
 *  search text; main owns every request, cache and world reference. */
export function registerCommunityHandlers(service: CommunityService): void {
  ipcMain.handle('get-profile', (event, req: IpcInvoke['get-profile']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = personRequest.parse(req)
    return service.getProfile(parsed.platform, parsed.userId)
  })
  ipcMain.handle('get-profile-worlds', (event, req: IpcInvoke['get-profile-worlds']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = personRequest.parse(req)
    return service.getProfileWorlds(parsed.platform, parsed.userId)
  })
  ipcMain.handle('get-profile-groups', (event, req: IpcInvoke['get-profile-groups']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = personRequest.parse(req)
    return service.getProfileGroups(parsed.platform, parsed.userId)
  })
  ipcMain.handle('search-community', (event, req: IpcInvoke['search-community']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = searchRequest.parse(req)
    return service.search(parsed.platform, parsed.query)
  })
  ipcMain.handle('get-world-list', (event, req: IpcInvoke['get-world-list']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = listRequest.parse(req)
    return service.getWorldList(parsed.platform, parsed.list, parsed.refresh === true)
  })
  ipcMain.handle('get-players-online', (event, req: IpcInvoke['get-players-online']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = platformRequest.parse(req)
    return service.getPlayersOnline(parsed.platform)
  })
  ipcMain.handle('get-my-groups', (event, req: IpcInvoke['get-my-groups']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = groupsRequest.parse(req)
    return service.getMyGroups(parsed.platform, parsed.refresh === true)
  })
}
