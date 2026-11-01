import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ExploreWorld } from '@shared/explore'
import type {
  GameFavoriteKind,
  GameFavorites,
  GameFavoritesResult,
  GameFavoritesUnavailable,
  GameFavoriteWriteFailure
} from '@shared/gameFavorites'
import type { FavoritesRevision } from '@shared/favorites'
import type { AuthStatus, Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { authStatusQueryKey } from './authKey'
import { useSignedInAccount } from './favorites'
import { queryClient } from './queryClient'

type Ready = Extract<GameFavoritesResult, { state: 'ready' }>

/** Section heading per platform (quoted keys for the i18n key scan). */
export const GAME_FAVORITES_HEADING: Record<Platform, string> = {
  vrchat: 'favorites.menu.vrchat',
  chilloutvr: 'favorites.menu.chilloutvr'
}

/** Prefix key for every account's game favorites on one platform (boundary clearing). */
export function gameFavoritesPlatformKey(
  platform: Platform
): readonly ['game-favorites', Platform] {
  return ['game-favorites', platform] as const
}

function gameFavoritesKey(
  platform: Platform,
  accountId: string | null
): readonly ['game-favorites', Platform, string] {
  return ['game-favorites', platform, accountId ?? ''] as const
}

async function fetchGameFavorites(
  platform: Platform,
  accountId: string,
  refresh: boolean
): Promise<GameFavoritesResult> {
  if (typeof window === 'undefined' || typeof window.vrx?.getGameFavorites !== 'function') {
    return { state: 'not-authenticated' }
  }
  const result = await window.vrx.getGameFavorites(refresh ? { platform, refresh } : { platform })
  if (!result || typeof result !== 'object') return { state: 'unavailable' }
  if (result.state !== 'ready') return { state: result.state }
  // An account swap can land between the key and the reply. Never keep
  // another account's favorites under this account's key.
  if (result.revision?.platformAccountId !== accountId) return { state: 'not-authenticated' }
  return {
    ...result,
    favorites: {
      ...result.favorites,
      worldList: result.favorites.worldList.filter((world) => world.platform === platform)
    }
  }
}

/**
 * A Refresh press: main reads the account again once its cooldown passed,
 * and otherwise answers from memory. The list keeps what it had on a failure.
 */
export async function refreshGameFavorites(platform: Platform): Promise<void> {
  const auth = queryClient.getQueryData<AuthStatus>(authStatusQueryKey(platform))
  const accountId = auth?.state === 'authenticated' ? (auth.accountId ?? null) : null
  if (accountId === null) return
  try {
    const next = await fetchGameFavorites(platform, accountId, true)
    const key = gameFavoritesKey(platform, accountId)
    const before = queryClient.getQueryData<GameFavoritesResult>(key)
    // A refused Refresh (the cooldown, a busy line) never hides what shows.
    if (next.state !== 'ready' && before?.state === 'ready') return
    queryClient.setQueryData(key, next)
  } catch {
    // The press can be tried again.
  }
}

export interface GameFavoritesState {
  /** `loading` until the first answer; `hidden` while signed out. */
  state: 'loading' | 'hidden' | 'ready' | GameFavoritesUnavailable
  favorites: GameFavorites | null
  revision: FavoritesRevision | null
  /** A Refresh press: main reads the account again after its cooldown. */
  refresh: () => Promise<void>
}

/**
 * The favorites in the signed-in user's own account on one platform. Main
 * reads the account once per sign-in and answers from memory after that, so
 * this never polls; Settings → Use my game favorites turns it off.
 */
export function useGameFavorites(
  platform: Platform,
  { enabled = true, rereadOnShow = false }: { enabled?: boolean; rereadOnShow?: boolean } = {}
): GameFavoritesState {
  const accountId = useSignedInAccount(platform)
  const on = useSettingsStore((s) => s.settings.useGameFavorites) === true
  const key = gameFavoritesKey(platform, accountId)
  const query = useQuery(
    {
      queryKey: key,
      queryFn: () => fetchGameFavorites(platform, accountId ?? '', false),
      enabled: accountId !== null && on && enabled,
      staleTime: Infinity,
      // Explore → Favorites asks again each time it shows, so its world
      // references are fresh. Main answers from memory (no platform request).
      refetchOnMount: rereadOnShow ? 'always' : true,
      retry: false,
      networkMode: 'always'
    },
    queryClient
  )
  const refresh = useCallback(() => refreshGameFavorites(platform), [platform])
  if (accountId === null) return { state: 'hidden', favorites: null, revision: null, refresh }
  if (!on) return { state: 'off', favorites: null, revision: null, refresh }
  const data = query.data
  if (!data) {
    return {
      state: query.isError ? 'unavailable' : 'loading',
      favorites: null,
      revision: null,
      refresh
    }
  }
  if (data.state !== 'ready') return { state: data.state, favorites: null, revision: null, refresh }
  return { state: 'ready', favorites: data.favorites, revision: data.revision, refresh }
}

/** Both platforms' friends in a game favorite group, as `platform:friendId` keys. */
export function useGameFavoriteFriendKeys(): ReadonlySet<string> {
  const vrc = useGameFavorites('vrchat').favorites?.friends
  const cvr = useGameFavorites('chilloutvr').favorites?.friends
  return useMemo(
    () =>
      new Set([
        ...Object.keys(vrc ?? {}).map((id) => `vrchat:${id}`),
        ...Object.keys(cvr ?? {}).map((id) => `chilloutvr:${id}`)
      ]),
    [vrc, cvr]
  )
}

export type GameFavoriteTarget =
  | { platform: Platform; kind: 'friend'; friendId: string }
  | { platform: Platform; kind: 'world'; world: ExploreWorld }

function targetId(target: GameFavoriteTarget): string {
  return target.kind === 'friend' ? target.friendId : target.world.worldId
}

function bucket(kind: GameFavoriteKind): 'friends' | 'worlds' {
  return kind === 'friend' ? 'friends' : 'worlds'
}

/** The favorites with one item's groups replaced, counts and world list kept in step. */
function withGroups(
  favorites: GameFavorites,
  target: GameFavoriteTarget,
  groups: readonly string[]
): GameFavorites {
  const id = targetId(target)
  const field = bucket(target.kind)
  const before = favorites[field][id] ?? []
  const items = { ...favorites[field] }
  if (groups.length > 0) items[id] = [...groups]
  else delete items[id]
  const delta = (key: string): number =>
    (groups.includes(key) ? 1 : 0) - (before.includes(key) ? 1 : 0)
  const counted = favorites.groups[target.kind].map((group) => ({
    ...group,
    count: Math.max(0, group.count + delta(group.key))
  }))
  let worldList = favorites.worldList
  if (target.kind === 'world') {
    // A new favorite goes first, as in main; one already listed keeps its place.
    const listed = worldList.some((world) => world.worldId === id)
    if (groups.length === 0) worldList = worldList.filter((world) => world.worldId !== id)
    else if (!listed) worldList = [target.world, ...worldList]
  }
  return {
    ...favorites,
    [field]: items,
    groups: { ...favorites.groups, [target.kind]: counted },
    worldList
  }
}

/**
 * Put a friend or world in one of the account's own favorite groups, or take
 * it out. One press is one write in main; the change shows at once and rolls
 * back if main refuses it. Resolves to the failure reason, or null.
 */
export function useSetGameFavorite(): (
  target: GameFavoriteTarget,
  groupKey: string,
  on: boolean
) => Promise<GameFavoriteWriteFailure | null> {
  const vrc = useSignedInAccount('vrchat')
  const cvr = useSignedInAccount('chilloutvr')
  return useCallback(
    async (target, groupKey, on) => {
      const accountId = target.platform === 'vrchat' ? vrc : cvr
      const bridge = window.vrx
      if (accountId === null || typeof bridge?.setGameFavorite !== 'function') {
        return 'not-authenticated'
      }
      const key = gameFavoritesKey(target.platform, accountId)
      const before = queryClient.getQueryData<GameFavoritesResult>(key)
      if (before?.state !== 'ready') return 'stale'
      const ready: Ready = before
      const current = ready.favorites[bucket(target.kind)][targetId(target)] ?? []
      const optimistic = on
        ? [...current.filter((k) => k !== groupKey), groupKey]
        : current.filter((k) => k !== groupKey)
      await queryClient.cancelQueries({ queryKey: key })
      const shown: Ready = { ...ready, favorites: withGroups(ready.favorites, target, optimistic) }
      queryClient.setQueryData<GameFavoritesResult>(key, () => shown)
      let reason: GameFavoriteWriteFailure | null = null
      let kept: string[] | null = null
      try {
        const result =
          target.kind === 'friend'
            ? await bridge.setGameFavorite({
                platform: target.platform,
                kind: 'friend',
                friendId: target.friendId,
                groupKey,
                on,
                revision: ready.revision
              })
            : await bridge.setGameFavorite({
                platform: target.platform,
                kind: 'world',
                worldRef: target.world.worldRef,
                groupKey,
                on,
                revision: ready.revision
              })
        if (result.ok) kept = result.groups
        else reason = result.reason
      } catch {
        reason = 'invalid'
      }
      const latest = queryClient.getQueryData<GameFavoritesResult>(key)
      if (latest?.state === 'ready') {
        const settled: Ready = {
          ...latest,
          favorites: withGroups(latest.favorites, target, kept ?? current)
        }
        queryClient.setQueryData<GameFavoritesResult>(key, () => settled)
      }
      return reason
    },
    [vrc, cvr]
  )
}
