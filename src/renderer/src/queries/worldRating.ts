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

interface InflightRating {
  optimistic: WorldRating
}

/** A press that has not answered yet. Shared by every mount of that world. */
const inflight = new Map<string, InflightRating>()
/** Bumped when a write starts, so a read already in flight cannot cache over it. */
const writeRevision = new Map<string, number>()
const inflightListeners = new Set<() => void>()

function ratingId(accountId: string, worldRef: string): string {
  return `${accountId}\n${worldRef}`
}

function emitInflight(): void {
  for (const listener of inflightListeners) listener()
}

function subscribe(listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe(listener)
}

function subscribeWorldRating(listener: () => void): () => void {
  const unsubscribe = subscribe(listener)
  inflightListeners.add(listener)
  return () => {
    unsubscribe()
    inflightListeners.delete(listener)
  }
}

function storedRating(accountId: string, worldRef: string): WorldRating | undefined {
  return queryClient.getQueryData<WorldRating>(worldRatingQueryKey(accountId, worldRef))
}

/** The rating on screen: the choice in flight, otherwise the cached answer. */
export function useWorldRatingValue(
  accountId: string | null,
  worldRef: string
): WorldRating | undefined {
  return useSyncExternalStore(
    subscribeWorldRating,
    () => {
      if (accountId === null) return undefined
      const flight = inflight.get(ratingId(accountId, worldRef))
      // `null` is a real "clear this rating" choice, not a missing one.
      if (flight) return flight.optimistic
      return storedRating(accountId, worldRef)
    },
    () => undefined
  )
}

/** True while a Like, Dislike or clear for this world has not answered yet. */
export function useWorldRatingPending(accountId: string | null, worldRef: string): boolean {
  return useSyncExternalStore(
    subscribeWorldRating,
    () => accountId !== null && inflight.has(ratingId(accountId, worldRef)),
    () => false
  )
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
  const id = ratingId(accountId, worldRef)
  const flight = inflight.get(id)
  // A press already chose the value. Don't read the old one back over it.
  if (flight) return { ok: true, value: flight.optimistic }
  const cached = cachedRating(accountId, worldRef)
  if (cached !== undefined) return { ok: true, value: cached }
  if (typeof window === 'undefined' || !window.vrx?.getWorldRating) {
    return { ok: false, reason: 'failed' }
  }
  const revision = writeRevision.get(id) ?? 0
  try {
    const result = await window.vrx.getWorldRating({ platform: 'vrchat', worldRef })
    if ((writeRevision.get(id) ?? 0) !== revision) {
      const flightNow = inflight.get(id)
      if (flightNow) return { ok: true, value: flightNow.optimistic }
      const kept = storedRating(accountId, worldRef)
      return kept === undefined ? result : { ok: true, value: kept }
    }
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
  const id = ratingId(accountId, worldRef)
  if (inflight.has(id)) return { ok: false, reason: 'cooldown' }
  writeRevision.set(id, (writeRevision.get(id) ?? 0) + 1)
  inflight.set(id, { optimistic: value })
  emitInflight()
  try {
    const result = await window.vrx.setWorldRating({ platform: 'vrchat', worldRef, value })
    if (result.ok) remember(accountId, worldRef, result.value)
    return result
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.message === 'rate_limited' ? 'rate-limited' : 'failed'
    }
  } finally {
    inflight.delete(id)
    emitInflight()
  }
}
