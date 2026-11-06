import { useSyncExternalStore } from 'react'
import type { SetHomeWorldResult } from '@shared/homeWorld'
import type { AuthStatus, Platform } from '@shared/types'
import { authStatusQueryKey } from './auth'
import { queryClient } from './queryClient'

/**
 * The world VRX made home in this session, per account. Nothing reads it from
 * a platform: it only remembers a successful press, so a world sheet can say
 * "Your home world" instead of offering the same change again. Like the rest
 * of Explore, it observes the shared cache instead of mounting queries, so a
 * world sheet never starts an auth read of its own.
 */
function homeWorldQueryKey(
  platform: Platform,
  accountId: string | null
): readonly ['home-world', Platform, string | null] {
  return ['home-world', platform, accountId] as const
}

/** Every remembered home world of one platform, any account (identity boundary). */
export function homeWorldQueryKeyForPlatform(
  platform: Platform
): readonly ['home-world', Platform] {
  return ['home-world', platform] as const
}

// Kept for the session: no observer ever mounts, so the default collection
// would otherwise forget a press after five minutes.
queryClient.setQueryDefaults(['home-world'], { gcTime: Infinity, staleTime: Infinity })

function subscribe(listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe(listener)
}

/** The signed-in account a platform's home-world change belongs to, or null. */
export function useHomeWorldAccount(platform: Platform): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const auth = queryClient.getQueryData<AuthStatus>(authStatusQueryKey(platform))
      return auth?.state === 'authenticated' ? (auth.accountId ?? null) : null
    },
    () => null
  )
}

/** The world ID this session made home for the account, or null when VRX did not. */
export function useHomeWorldId(platform: Platform, accountId: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () =>
      accountId === null
        ? null
        : (queryClient.getQueryData<string>(homeWorldQueryKey(platform, accountId)) ?? null),
    () => null
  )
}

export interface SetHomeWorldInput {
  platform: Platform
  /** Main's Explore reference; main resolves it to the platform's world ID. */
  worldRef: string
  /** The account the sheet showed; only that account's memory changes. */
  accountId: string
}

/** One press, one write. A typed failure is data (`ok: false`), never retried. */
export async function setHomeWorld({
  platform,
  worldRef,
  accountId
}: SetHomeWorldInput): Promise<SetHomeWorldResult> {
  if (typeof window === 'undefined' || !window.vrx) throw new Error('bridge_unavailable')
  const result = await window.vrx.setHomeWorld({ platform, worldRef })
  if (result.ok && result.platform === platform) {
    queryClient.setQueryData(homeWorldQueryKey(platform, accountId), result.worldId)
  }
  return result
}
