import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { GameFavoritesResult } from '@shared/gameFavorites'
import type { Platform } from '@shared/types'
import type { GameFavoritesService } from '../services/gameFavorites'
import type { FavoriteWorldsExplore } from './favorites'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const revision = z
  .object({ platformAccountId: z.string().min(1).max(256), epoch: z.number().int() })
  .strict()
const getRequest = z.object({ platform, refresh: z.boolean().optional() }).strict()
const groupKey = z.string().min(1).max(160)
const setRequest = z.discriminatedUnion('kind', [
  z
    .object({
      platform,
      kind: z.literal('friend'),
      // Shape only here; the service checks the id against the platform.
      friendId: z.string().min(1).max(128),
      groupKey,
      on: z.boolean(),
      revision
    })
    .strict(),
  z
    .object({
      platform,
      kind: z.literal('world'),
      worldRef: z.string().min(1).max(128),
      groupKey,
      on: z.boolean(),
      revision
    })
    .strict()
])

/**
 * The favorites in the user's own VRChat and ChilloutVR accounts. A world is
 * named by main's own Explore reference, never by a renderer-supplied id or
 * picture, and listing favorite worlds only issues references.
 */
export function registerGameFavoritesHandlers(
  service: GameFavoritesService,
  explore: FavoriteWorldsExplore
): void {
  ipcMain.handle(
    'get-game-favorites',
    async (event, req: IpcInvoke['get-game-favorites']['req']): Promise<GameFavoritesResult> => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const parsed = getRequest.safeParse(req)
      if (!parsed.success) throw new Error('Invalid get-game-favorites request')
      const target: Platform = parsed.data.platform
      const result = await service.get(target, parsed.data.refresh === true)
      if (result.state !== 'ready') return { state: result.state }
      const { worldEvidence, ...view } = result.view
      return {
        state: 'ready',
        favorites: { ...view, worldList: explore.adoptWorlds(target, worldEvidence) },
        revision: result.revision
      }
    }
  )

  ipcMain.handle('set-game-favorite', (event, req: IpcInvoke['set-game-favorite']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = setRequest.safeParse(req)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    const request = parsed.data
    if (request.kind === 'friend') {
      return service.set({
        platform: request.platform,
        kind: 'friend',
        id: request.friendId,
        groupKey: request.groupKey,
        on: request.on,
        revision: request.revision
      })
    }
    const world = explore.worldEvidence(request.platform, request.worldRef)
    // An expired reference is a stale view; the renderer reads again.
    if (world === null || world.platform !== request.platform) {
      return { ok: false, reason: 'stale' }
    }
    return service.set({
      platform: request.platform,
      kind: 'world',
      id: world.worldId,
      groupKey: request.groupKey,
      on: request.on,
      revision: request.revision,
      world
    })
  })
}
