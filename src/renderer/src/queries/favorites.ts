import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { ExploreWorld } from '@shared/explore'
import type { FavoriteWriteResult } from '@shared/favorites'
import type { AuthStatus, Friend, Platform } from '@shared/types'
import { authStatusQueryKey } from './authKey'
import { queryClient } from './queryClient'

type FavoriteFriends = IpcInvoke['get-favorite-friends']['res']
type FavoriteWorlds = IpcInvoke['get-favorite-worlds']['res']
export type FavoriteSaveFailure = Extract<FavoriteWriteResult, { ok: false }>['reason']

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']
const NO_FRIENDS: FavoriteFriends = { friendIds: [] }
const NO_WORLDS: FavoriteWorlds = { worlds: [] }

/** Prefix keys for every account's favorites on one platform (boundary clearing). */
export function favoritesPlatformKeys(
  platform: Platform
): readonly [readonly ['favorite-friends', Platform], readonly ['favorite-worlds', Platform]] {
  return [['favorite-friends', platform] as const, ['favorite-worlds', platform] as const]
}

function friendsKey(
  platform: Platform,
  accountId: string | null
): readonly ['favorite-friends', Platform, string] {
  return ['favorite-friends', platform, accountId ?? ''] as const
}

function worldsKey(
  platform: Platform,
  accountId: string | null
): readonly ['favorite-worlds', Platform, string] {
  return ['favorite-worlds', platform, accountId ?? ''] as const
}

/**
 * The signed-in account, read from the shared client's auth cache. App owns
 * the auth queries; favorites only observe them, so a star never starts a
 * sign-in check, and every favorites read uses that same shared client.
 */
function useSignedInAccount(platform: Platform): string | null {
  const auth = useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryData<AuthStatus>(authStatusQueryKey(platform)),
    () => undefined
  )
  return auth?.state === 'authenticated' ? (auth.accountId ?? null) : null
}

async function fetchFriends(platform: Platform, accountId: string): Promise<FavoriteFriends> {
  if (typeof window === 'undefined' || typeof window.vrx?.getFavoriteFriends !== 'function') {
    return NO_FRIENDS
  }
  const result = await window.vrx.getFavoriteFriends({ platform })
  if (!result || !Array.isArray(result.friendIds)) return NO_FRIENDS
  // An account swap can land between the key and the reply. Never keep
  // another account's stars or revision under this account's key.
  if (result.revision?.platformAccountId !== accountId) return NO_FRIENDS
  return {
    friendIds: result.friendIds.filter((id): id is string => typeof id === 'string'),
    revision: result.revision
  }
}

async function fetchWorlds(platform: Platform, accountId: string): Promise<FavoriteWorlds> {
  if (typeof window === 'undefined' || typeof window.vrx?.getFavoriteWorlds !== 'function') {
    return NO_WORLDS
  }
  const result = await window.vrx.getFavoriteWorlds({ platform })
  if (!result || !Array.isArray(result.worlds)) return NO_WORLDS
  if (result.revision?.platformAccountId !== accountId) return NO_WORLDS
  return {
    worlds: result.worlds.filter((world) => world.platform === platform),
    revision: result.revision
  }
}

/**
 * The signed-in account's favorite friends on one platform. Local data that
 * only VRX writes, so it never goes stale on its own; the identity boundary
 * in useLiveFriendEvents clears it and the account id keys it.
 */
export function useFavoriteFriends(platform: Platform): {
  accountId: string | null
  favorites: ReadonlySet<string>
  writable: boolean
} {
  const accountId = useSignedInAccount(platform)
  const query = useQuery(
    {
      queryKey: friendsKey(platform, accountId),
      queryFn: () => fetchFriends(platform, accountId ?? ''),
      enabled: accountId !== null,
      staleTime: Infinity,
      networkMode: 'always'
    },
    queryClient
  )
  const data = accountId === null ? undefined : query.data
  const ids = data?.friendIds
  const favorites = useMemo(() => new Set(ids ?? []), [ids])
  return { accountId, favorites, writable: data?.revision !== undefined }
}

/** Both platforms' favorite friends as `platform:friendId` keys. */
export function useFavoriteFriendKeys(): ReadonlySet<string> {
  const vrc = useFavoriteFriends('vrchat').favorites
  const cvr = useFavoriteFriends('chilloutvr').favorites
  return useMemo(
    () =>
      new Set([
        ...[...vrc].map((id) => `vrchat:${id}`),
        ...[...cvr].map((id) => `chilloutvr:${id}`)
      ]),
    [vrc, cvr]
  )
}

/** Whether any of these accounts is starred (a linked person is one star). */
export function isFavoriteAccount(
  keys: ReadonlySet<string>,
  accounts: readonly Pick<Friend, 'platform' | 'platformUserId'>[]
): boolean {
  return accounts.some((account) => keys.has(`${account.platform}:${account.platformUserId}`))
}

/**
 * Star or unstar a friend, or every account of a linked person together. The
 * change shows at once and rolls back if main refuses it. Resolves to the
 * failure reason, or null.
 */
export function useSetFavoriteFriends(): (
  accounts: readonly Pick<Friend, 'platform' | 'platformUserId'>[],
  favorite: boolean
) => Promise<FavoriteSaveFailure | null> {
  const vrc = useSignedInAccount('vrchat')
  const cvr = useSignedInAccount('chilloutvr')
  return useCallback(
    async (accounts, favorite) => {
      const accountIds: Record<Platform, string | null> = { vrchat: vrc, chilloutvr: cvr }
      const bridge = window.vrx
      let failure: FavoriteSaveFailure | null = null
      for (const platform of PLATFORMS) {
        const ids = accounts.filter((a) => a.platform === platform).map((a) => a.platformUserId)
        if (ids.length === 0) continue
        const key = friendsKey(platform, accountIds[platform])
        const revision = queryClient.getQueryData<FavoriteFriends>(key)?.revision
        if (accountIds[platform] === null || revision === undefined || !bridge?.setFavoriteFriend) {
          failure ??= 'not-authenticated'
          continue
        }
        await queryClient.cancelQueries({ queryKey: key })
        queryClient.setQueryData<FavoriteFriends>(key, (current) => {
          const next = new Set(current?.friendIds ?? [])
          for (const id of ids) {
            if (favorite) next.add(id)
            else next.delete(id)
          }
          return { friendIds: [...next], revision: current?.revision }
        })
        let reason: FavoriteSaveFailure | null
        try {
          const result = await bridge.setFavoriteFriend({
            platform,
            friendIds: ids,
            favorite,
            revision
          })
          reason = result.ok ? null : result.reason
        } catch {
          reason = 'invalid'
        }
        // Reread on any failure so the star shows what main actually kept.
        if (reason !== null) void queryClient.invalidateQueries({ queryKey: key })
        failure ??= reason
      }
      return failure
    },
    [vrc, cvr]
  )
}

/**
 * The signed-in account's favorite worlds on one platform, newest first, with
 * references main issued for the shared world sheet. Reading them makes no
 * platform request. `enabled` lets a page read them only while it shows them.
 */
export function useFavoriteWorlds(
  platform: Platform,
  { enabled = true, rereadOnShow = false }: { enabled?: boolean; rereadOnShow?: boolean } = {}
): {
  accountId: string | null
  worlds: readonly ExploreWorld[]
  ids: ReadonlySet<string>
  writable: boolean
  isLoading: boolean
  refetch: () => Promise<readonly ExploreWorld[]>
} {
  const accountId = useSignedInAccount(platform)
  const query = useQuery(
    {
      queryKey: worldsKey(platform, accountId),
      queryFn: () => fetchWorlds(platform, accountId ?? ''),
      enabled: accountId !== null && enabled,
      staleTime: Infinity,
      // The Favorites list reads again each time it shows, so its world
      // references are fresh (a local read; no platform request).
      refetchOnMount: rereadOnShow ? 'always' : true,
      networkMode: 'always'
    },
    queryClient
  )
  const data = accountId === null ? undefined : query.data
  const worlds = data?.worlds ?? NO_WORLDS.worlds
  const ids = useMemo(() => new Set(worlds.map((world) => world.worldId)), [worlds])
  const { refetch } = query
  const reread = useCallback(async () => {
    const result = await refetch()
    return result.data?.worlds ?? []
  }, [refetch])
  return {
    accountId,
    worlds,
    ids,
    writable: data?.revision !== undefined,
    isLoading: accountId !== null && enabled && query.isPending,
    refetch: reread
  }
}

/**
 * Star a world (by the reference on its sheet) or unstar it. The change shows
 * at once; main stores the name and picture from its own record, and a
 * refused change rolls back. Resolves to the failure reason, or null.
 */
export function useSetFavoriteWorld(): (
  world: ExploreWorld,
  favorite: boolean
) => Promise<FavoriteSaveFailure | null> {
  const vrc = useSignedInAccount('vrchat')
  const cvr = useSignedInAccount('chilloutvr')
  return useCallback(
    async (world, favorite) => {
      const accountId = world.platform === 'vrchat' ? vrc : cvr
      const key = worldsKey(world.platform, accountId)
      const bridge = window.vrx
      let revision = queryClient.getQueryData<FavoriteWorlds>(key)?.revision
      if (accountId !== null && revision === undefined) {
        // The star can be pressed before the list was ever read. A failed
        // read (a rate-limited bridge) is a refused change, never a throw, so
        // the star stays pressable.
        try {
          revision = (
            await queryClient.fetchQuery({
              queryKey: key,
              queryFn: () => fetchWorlds(world.platform, accountId),
              staleTime: Infinity,
              retry: false
            })
          ).revision
        } catch {
          return 'invalid'
        }
      }
      if (accountId === null || revision === undefined || !bridge?.setFavoriteWorld) {
        return 'not-authenticated'
      }
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<FavoriteWorlds>(key, (current) => {
        const others = (current?.worlds ?? []).filter((item) => item.worldId !== world.worldId)
        return { worlds: favorite ? [world, ...others] : others, revision: current?.revision }
      })
      let reason: FavoriteSaveFailure | null
      try {
        const result = favorite
          ? await bridge.setFavoriteWorld({
              platform: world.platform,
              favorite: true,
              worldRef: world.worldRef,
              revision
            })
          : await bridge.setFavoriteWorld({
              platform: world.platform,
              favorite: false,
              worldId: world.worldId,
              revision
            })
        reason = result.ok ? null : result.reason
      } catch {
        reason = 'invalid'
      }
      // A refused change rereads what main kept.
      if (reason !== null) void queryClient.invalidateQueries({ queryKey: key })
      return reason
    },
    [vrc, cvr]
  )
}
