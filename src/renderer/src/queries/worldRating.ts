import { useSyncExternalStore } from 'react'
import type { SetWorldRatingResult, WorldRating, WorldRatingRead } from '@shared/worldRating'
import { WORLD_RATING_CACHE_MS } from '@shared/worldRating'
import type { AuthStatus } from '@shared/types'
import { authStatusQueryKey } from './auth'
import { queryClient } from './queryClient'

/** How long the sheet keeps a rating it already read. Main keeps its own copy too. */
export const worldRatingQueryKey = (
  accountId: string,
  worldRef: string
): readonly ['world-rating', 'vrchat', string, string] =>
  ['world-rating', 'vrchat', accountId, worldRef] as const

/** Every cached rating for one platform (identity boundary). */
export function worldRatingQueryKeyForPlatform(
  platform: 'vrchat' | 'chilloutvr'
): readonly ['world-rating', 'vrchat' | 'chilloutvr'] {
  return ['world-rating', platform] as const
}

queryClient.setQueryDefaults(['world-rating'], { gcTime: 30 * 60 * 1000 })

function subscribe(listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe(listener)
}

/** The signed-in VRChat account a rating belongs to, or null. */
export function useWorldRatingAccount(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const auth = queryClient.getQueryData<AuthStatus>(authStatusQueryKey('vrchat'))
      return auth?.state === 'authenticated' ? (auth.accountId ?? null) : null
    },
    () => null
  )
}

function cachedRating(accountId: string, worldRef: string): WorldRating | undefined {
  const key = worldRatingQueryKey(accountId, worldRef)
  const value = queryClient.getQueryData<WorldRating>(key)
  const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0
  if (value === undefined || Date.now() - updatedAt >= WORLD_RATING_CACHE_MS) return undefined
  return value
}

function remember(accountId: string, worldRef: string, value: WorldRating): void {
  queryClient.setQueryData(worldRatingQueryKey(accountId, worldRef), value)
}

function denied(error: unknown): WorldRatingRead {
  const reason =
    error instanceof Error && error.message === 'rate_limited' ? 'rate-limited' : 'failed'
  return { ok: false, reason }
}

/** One sheet open, one read. A fresh answer already in the cache sends nothing. */
export async function readWorldRating(
  accountId: string,
  worldRef: string
): Promise<WorldRatingRead> {
  const cached = cachedRating(accountId, worldRef)
  if (cached !== undefined) return { ok: true, value: cached }
  if (typeof window === 'undefined' || !window.vrx?.getWorldRating) {
    return { ok: false, reason: 'failed' }
  }
  try {
    const result = await window.vrx.getWorldRating({ platform: 'vrchat', worldRef })
    if (result.ok) remember(accountId, worldRef, result.value)
    return result
  } catch (error) {
    return denied(error)
  }
}

/** One press, one write. A typed failure is data (`ok: false`), never retried. */
export async function writeWorldRating(
  accountId: string,
  worldRef: string,
  value: WorldRating
): Promise<SetWorldRatingResult> {
  if (typeof window === 'undefined' || !window.vrx?.setWorldRating) {
    return { ok: false, reason: 'failed' }
  }
  try {
    const result = await window.vrx.setWorldRating({ platform: 'vrchat', worldRef, value })
    if (result.ok) remember(accountId, worldRef, result.value)
    return result
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.message === 'rate_limited' ? 'rate-limited' : 'failed'
    }
  }
}
