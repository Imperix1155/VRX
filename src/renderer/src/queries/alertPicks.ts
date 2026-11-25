import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import { useAuthStatus } from './auth'

type AlertPicks = IpcInvoke['get-alert-picks']['res']
type SaveReason = Extract<IpcInvoke['set-alert-pick']['res'], { ok: false }>['reason']

const NO_PICKS: AlertPicks = { friendIds: [], bypassFriendIds: [], optOuts: {} }

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

async function fetchAlertPicks(platform: Platform, accountId: string): Promise<AlertPicks> {
  if (typeof window === 'undefined' || typeof window.vrx?.getAlertPicks !== 'function') {
    return NO_PICKS
  }
  const result = await window.vrx.getAlertPicks({ platform })
  if (!result || !Array.isArray(result.friendIds)) return NO_PICKS
  // An account swap can land between the key and the reply. Never keep
  // another account's picks or revision under this account's key.
  if (result.revision?.platformAccountId !== accountId) return NO_PICKS
  const bypassFriendIds = Array.isArray(result.bypassFriendIds) ? result.bypassFriendIds : []
  const optOuts =
    result.optOuts !== null && typeof result.optOuts === 'object' ? result.optOuts : {}
  return {
    friendIds: result.friendIds.filter((id): id is string => typeof id === 'string'),
    bypassFriendIds: bypassFriendIds.filter((id): id is string => typeof id === 'string'),
    optOuts,
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
  /** Friends who bypass Do not disturb. Empty until loaded, and by default. */
  bypass: ReadonlySet<string>
  /** Types each friend turned off. A missing friend has every type on. */
  optOuts: ReadonlyMap<string, ReadonlySet<string>>
  /** Loaded with a revision, so a change can be saved. */
  writable: boolean
} {
  const auth = useAuthStatus(platform)
  const accountId = auth.data?.state === 'authenticated' ? (auth.data.accountId ?? null) : null
  const query = useQuery({
    queryKey: alertPicksQueryKey(platform, accountId),
    queryFn: () => fetchAlertPicks(platform, accountId ?? ''),
    enabled: accountId !== null,
    staleTime: Infinity,
    networkMode: 'always'
  })
  const data = accountId === null ? undefined : query.data
  const ids = data?.friendIds
  const bypassIds = data?.bypassFriendIds
  const rawOptOuts = data?.optOuts
  const picked = useMemo(() => new Set(ids ?? []), [ids])
  const bypass = useMemo(() => new Set(bypassIds ?? []), [bypassIds])
  const optOuts = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>()
    for (const [friendId, types] of Object.entries(rawOptOuts ?? {})) {
      if (Array.isArray(types)) map.set(friendId, new Set(types))
    }
    return map
  }, [rawOptOuts])
  return { accountId, picked, bypass, optOuts, writable: data?.revision !== undefined }
}

function kept(current: AlertPicks | undefined): AlertPicks {
  return {
    friendIds: current?.friendIds ?? [],
    bypassFriendIds: current?.bypassFriendIds ?? [],
    optOuts: current?.optOuts ?? {},
    revision: current?.revision
  }
}

function withPicks(
  current: AlertPicks | undefined,
  friendIds: readonly string[],
  picked: boolean
): AlertPicks {
  const ids = new Set(current?.friendIds ?? [])
  for (const id of friendIds) {
    if (picked) ids.add(id)
    else ids.delete(id)
  }
  return { ...kept(current), friendIds: [...ids] }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** The change fields of `set-friend-alert`, taken from the shared request. */
export type FriendAlertChange = DistributiveOmit<
  IpcInvoke['set-friend-alert']['req'],
  'platform' | 'friendIds' | 'revision'
>

function withFriendAlert(
  current: AlertPicks | undefined,
  friendIds: readonly string[],
  change: FriendAlertChange
): AlertPicks {
  const base = kept(current)
  if (change.kind === 'bypass') {
    const ids = new Set(base.bypassFriendIds)
    for (const id of friendIds) {
      if (change.enabled) ids.add(id)
      else ids.delete(id)
    }
    return { ...base, bypassFriendIds: [...ids] }
  }
  const optOuts = { ...base.optOuts }
  for (const id of friendIds) {
    const types = new Set(optOuts[id] ?? [])
    if (change.enabled) types.delete(change.type)
    else types.add(change.type)
    if (types.size === 0) delete optOuts[id]
    else optOuts[id] = [...types]
  }
  return { ...base, optOuts }
}

async function savePicks(
  bridge: NonNullable<Window['vrx']>,
  request: IpcInvoke['set-alert-pick']['req']
): Promise<SaveReason | null> {
  try {
    const result = await bridge.setAlertPick(request)
    return result.ok ? null : result.reason
  } catch {
    return 'invalid'
  }
}

/**
 * Pick or unpick friends for alerts. The change shows at once and rolls back
 * if main refuses it. Resolves to the failure reason, or null.
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
      const key = alertPicksQueryKey(platform, accountId)
      const revision = queryClient.getQueryData<AlertPicks>(key)?.revision
      const bridge = window.vrx
      if (accountId === null || revision === undefined || !bridge?.setAlertPick) {
        return 'not-authenticated'
      }
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<AlertPicks>(key, (current) => withPicks(current, friendIds, picked))
      const failure = await savePicks(bridge, {
        platform,
        friendIds: [...friendIds],
        picked,
        revision
      })
      // Reread on any failure so the panel shows what main actually kept, and
      // answer only once it does, so a refused Remove's row is back by then.
      // The picks live in VRX; nothing here reaches a platform.
      if (failure !== null) await queryClient.invalidateQueries({ queryKey: key })
      return failure
    },
    [queryClient]
  )
}

/**
 * Turn one of a friend's alert types, or their Do not disturb bypass, on or
 * off. The change shows at once and rolls back if main refuses it.
 */
export function useSetFriendAlert(): (
  platform: Platform,
  accountId: string | null,
  friendIds: readonly string[],
  change: FriendAlertChange
) => Promise<SaveReason | null> {
  const queryClient = useQueryClient()
  return useCallback(
    async (platform, accountId, friendIds, change) => {
      const key = alertPicksQueryKey(platform, accountId)
      const revision = queryClient.getQueryData<AlertPicks>(key)?.revision
      const bridge = window.vrx
      if (accountId === null || revision === undefined || !bridge?.setFriendAlert) {
        return 'not-authenticated'
      }
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<AlertPicks>(key, (current) =>
        withFriendAlert(current, friendIds, change)
      )
      let failure: SaveReason | null
      try {
        const result = await bridge.setFriendAlert({
          platform,
          friendIds: [...friendIds],
          revision,
          ...change
        })
        failure = result.ok ? null : result.reason
      } catch {
        failure = 'invalid'
      }
      if (failure !== null) await queryClient.invalidateQueries({ queryKey: key })
      return failure
    },
    [queryClient]
  )
}
