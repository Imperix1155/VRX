import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import type { ExploreWorldEvidence } from '../services/adapters/ExploreAdapter'
import type { FavoriteWorld, Favorites } from '../services/favorites'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const revision = z
  .object({ platformAccountId: z.string().min(1).max(256), epoch: z.number().int() })
  .strict()
const platformRequest = z.object({ platform }).strict()
const friendsRequest = z
  .object({
    platform,
    // Shape only here; Favorites checks each id and the cap.
    friendIds: z.array(z.string()).min(1).max(5_000),
    favorite: z.boolean(),
    revision
  })
  .strict()
const worldRequest = z.discriminatedUnion('favorite', [
  z
    .object({ platform, favorite: z.literal(true), worldRef: z.string().min(1).max(128), revision })
    .strict(),
  z
    .object({ platform, favorite: z.literal(false), worldId: z.string().min(1).max(128), revision })
    .strict()
])

/** The two Explore calls favorites need, so tests can stand in for the service. */
export interface FavoriteWorldsExplore {
  adoptWorlds(platform: Platform, evidence: readonly ExploreWorldEvidence[]): ExploreWorld[]
  worldEvidence(platform: Platform, worldRef: string): ExploreWorldEvidence | null
}

/** A stored favorite as Explore evidence. Counts are unknown until its sheet reads it. */
function asEvidence(platform: Platform, world: FavoriteWorld, index: number): ExploreWorldEvidence {
  return {
    platform,
    worldId: world.worldId,
    name: world.name,
    thumbnailUrl: world.thumbnailUrl,
    activity: { state: 'unknown', value: null, source: 'unknown' },
    visibleRoomCount: { state: 'unknown', value: null, source: 'unknown' },
    popularity: null,
    sourceOrder: index
  }
}

/**
 * Favorite friends and worlds. Local to VRX: nothing here reaches a platform.
 * World stars take main's own Explore reference, never a renderer-named
 * picture, and listing favorites only issues references (no request).
 */
export function registerFavoritesHandlers(
  favorites: Favorites,
  explore: FavoriteWorldsExplore
): void {
  ipcMain.handle('get-favorite-friends', (event, req: IpcInvoke['get-favorite-friends']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = platformRequest.safeParse(req)
    if (!parsed.success) throw new Error('Invalid get-favorite-friends request')
    return favorites.listFriends(parsed.data.platform)
  })

  ipcMain.handle('set-favorite-friend', (event, req: IpcInvoke['set-favorite-friend']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = friendsRequest.safeParse(req)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    const { platform: target, friendIds, favorite, revision: echoed } = parsed.data
    return favorites.setFriends(target, friendIds, favorite, echoed)
  })

  ipcMain.handle('get-favorite-worlds', (event, req: IpcInvoke['get-favorite-worlds']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = platformRequest.safeParse(req)
    if (!parsed.success) throw new Error('Invalid get-favorite-worlds request')
    const target = parsed.data.platform
    const { worlds, revision: current } = favorites.listWorlds(target)
    if (current === undefined) return { worlds: [] }
    const adopted = explore.adoptWorlds(
      target,
      worlds.map((world, index) => asEvidence(target, world, index))
    )
    return { worlds: adopted, revision: current }
  })

  ipcMain.handle('set-favorite-world', (event, req: IpcInvoke['set-favorite-world']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = worldRequest.safeParse(req)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    const request = parsed.data
    if (!request.favorite) {
      return favorites.removeWorld(request.platform, request.worldId, request.revision)
    }
    const evidence = explore.worldEvidence(request.platform, request.worldRef)
    // An expired reference is a stale view; the renderer reads again.
    if (evidence === null || evidence.platform !== request.platform) {
      return { ok: false, reason: 'stale' }
    }
    return favorites.addWorld(
      request.platform,
      { worldId: evidence.worldId, name: evidence.name, thumbnailUrl: evidence.thumbnailUrl },
      request.revision
    )
  })
}
