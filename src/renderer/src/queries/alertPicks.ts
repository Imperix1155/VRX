import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import { useAuthStatus } from './auth'

export type AlertPicks = IpcInvoke['get-alert-picks']['res']
type SaveReason = Extract<IpcInvoke['set-alert-pick']['res'], { ok: false }>['reason']

const NO_PICKS: AlertPicks = { friendIds: [] }

/** Prefix key for every account's picks on one platform (boundary clearing). */
export function alertPicksPlatformKey(platform: Platform): readonly ['alert-picks', Platform] {
  return ['alert-picks', platform] as const
}

function alertPicksQueryKey(
  platform: Platform,
  accountId: string | null
): readonly ['alert-picks', Platform, string] {
  return ['alert-picks', platform, accountId ?? ''] as const
}

async function fetchAlertPicks(platform: Platform): Promise<AlertPicks> {
  if (typeof window === 'undefined' || typeof window.vrx?.getAlertPicks !== 'function') {
    return NO_PICKS
  }
  const result = await window.vrx.getAlertPicks({ platform })
  if (!result || !Array.isArray(result.friendIds)) return NO_PICKS
  return {
    friendIds: result.friendIds.filter((id): id is string => typeof id === 'string'),
    revision: result.revision
  }
}

/**
 * The signed-in account's friends picked for alerts on one platform. Local
 * data that only VRX writes, so it never goes stale on its own; the identity
 * boundary in useLiveFriendEvents clears it and the account id keys it.
 */
export function useAlertPicks(platform: Platform): {
  accountId: string | null
  /** Picked friend ids for the signed-in account; empty until loaded. */
  picked: ReadonlySet<string>
  /** Loaded with a revision, so a change can be saved. */
  writable: boolean
} {
  const auth = useAuthStatus(platform)
  const accountId = auth.data?.state === 'authenticated' ? (auth.data.accountId ?? null) : null
  const query = useQuery({
    queryKey: alertPicksQueryKey(platform, accountId),
    queryFn: () => fetchAlertPicks(platform),
    enabled: accountId !== null,
    staleTime: Infinity,
    networkMode: 'always'
  })
  const data = accountId === null ? undefined : query.data
  const ids = data?.friendIds
  const picked = useMemo(() => new Set(ids ?? []), [ids])
  return { accountId, picked, writable: data?.revision !== undefined }
}

/**
 * Pick or unpick friends for alerts. The change shows at once and rolls back
 * if main refuses it. Resolves to the first failure reason, or null.
 */
export function useSetAlertPicks(): (
  platform: Platform,
  accountId: string | null,
  friendIds: readonly string[],
  picked: boolean
) => Promise<SaveReason | null> {
  const queryClient = useQueryClient()
  return useCallback(
    async (platform, accountId, friendIds, picked) => {
      if (accountId === null || typeof window === 'undefined' || !window.vrx?.setAlertPick) {
        return 'not-authenticated'
      }
      const key = alertPicksQueryKey(platform, accountId)
      const before = queryClient.getQueryData<AlertPicks>(key)
      if (!before?.revision) return 'not-authenticated'
      const revision = before.revision
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<AlertPicks>(key, (current) => {
        const ids = new Set(current?.friendIds ?? [])
        for (const id of friendIds) {
          if (picked) ids.add(id)
          else ids.delete(id)
        }
        return { friendIds: [...ids], revision: current?.revision ?? revision }
      })
      let failure: SaveReason | null = null
      try {
        const result = await window.vrx.setAlertPick({
          platform,
          friendIds: [...friendIds],
          picked,
          revision
        })
        if (!result.ok) failure = result.reason
      } catch {
        failure = 'invalid'
      }
      // Reread on any failure so the panel shows what main actually kept.
      if (failure !== null) void queryClient.invalidateQueries({ queryKey: key })
      return failure
    },
    [queryClient]
  )
}
