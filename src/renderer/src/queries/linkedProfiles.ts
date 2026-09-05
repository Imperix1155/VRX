import { useContext, useEffect, useState } from 'react'
import {
  QueryClient,
  QueryClientContext,
  useQuery,
  useQueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import type { LinkRequest, LinkResult, LinkSnapshot } from '@shared/linkedProfiles'
import type { Friend } from '@shared/types'

export const linkedProfilesKey = ['linked-profiles'] as const
const emptyLinkSnapshot: LinkSnapshot = {
  profiles: [],
  lease: '',
  storeRevision: 0,
  accountIds: {}
}

/** Used at publication time by every read and write, not at request start. */
export function retainNewestLinkSnapshot(previous: unknown, incoming: unknown): LinkSnapshot {
  const current = previous as LinkSnapshot | undefined
  const next = incoming as LinkSnapshot
  return current?.lease === next.lease && current.storeRevision > next.storeRevision
    ? current
    : next
}

export async function fetchLinkedProfiles(signal?: AbortSignal): Promise<LinkSnapshot> {
  if (typeof window === 'undefined' || typeof window.vrx?.getLinkedProfiles !== 'function')
    throw new Error('unavailable')
  const result = await window.vrx.getLinkedProfiles()
  if (signal?.aborted) throw new Error('stale')
  if (!result.ok) throw new Error(result.reason)
  return result.value
}

export function useLinkedProfiles(): UseQueryResult<LinkSnapshot, Error> {
  const provided = useContext(QueryClientContext)
  const [fallback] = useState(() => new QueryClient())
  return useQuery(
    {
      queryKey: linkedProfilesKey,
      queryFn: ({ signal }) => fetchLinkedProfiles(signal),
      staleTime: Infinity,
      retry: false,
      structuralSharing: retainNewestLinkSnapshot,
      enabled: typeof window !== 'undefined' && typeof window.vrx?.getLinkedProfiles === 'function'
    },
    provided ?? fallback
  )
}

export async function changeLinkedProfile(
  client: QueryClient,
  lease: string,
  change: LinkRequest
): Promise<LinkResult<LinkSnapshot>> {
  if (!lease || client.getQueryData<LinkSnapshot>(linkedProfilesKey)?.lease !== lease)
    return { ok: false, reason: 'stale' }
  if (typeof window === 'undefined' || typeof window.vrx?.changeLinkedProfile !== 'function')
    return { ok: false, reason: 'unavailable' }
  try {
    const result = await window.vrx.changeLinkedProfile({ lease, change })
    if (client.getQueryData<LinkSnapshot>(linkedProfilesKey)?.lease !== lease)
      return { ok: false, reason: 'stale' }
    if (result.ok) {
      const adopted = client.setQueryData<LinkSnapshot>(linkedProfilesKey, (previous) =>
        retainNewestLinkSnapshot(previous, result.value)
      )
      return { ok: true, value: adopted ?? result.value }
    }
    return result
  } catch {
    return { ok: false, reason: 'storage' }
  }
}

/** One app-lifetime subscription; shared notes never enter persisted friends caches. */
export function subscribeLinkedProfiles(client: QueryClient): () => void {
  if (typeof window === 'undefined') return () => {}
  const names = new Map<string, string>()
  const fingerprint = (data: unknown): string =>
    JSON.stringify(
      Array.isArray(data)
        ? (data as Friend[]).map((friend) => [friend.platformUserId, friend.displayName])
        : []
    )
  for (const query of client.getQueryCache().getAll()) {
    if (query.queryKey[0] === 'friends') names.set(query.queryHash, fingerprint(query.state.data))
  }
  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: linkedProfilesKey })
  }
  const changed = window.vrx?.onLinkedProfilesChanged?.(invalidate)
  const boundary = window.vrx?.onIdentityBoundary?.(() => {
    void client.cancelQueries({ queryKey: linkedProfilesKey })
    client.setQueryData(linkedProfilesKey, emptyLinkSnapshot)
    invalidate()
  })
  const auth = client.getQueryCache().subscribe((event) => {
    const queryKey = event.query.queryKey as readonly unknown[]
    if (event.type === 'updated' && queryKey[0] === 'friends' && event.action.type === 'success') {
      const next = fingerprint(event.query.state.data)
      const previous = names.get(event.query.queryHash)
      names.set(event.query.queryHash, next)
      if (next !== previous) invalidate()
    }
    if (
      event.type === 'updated' &&
      queryKey[0] === 'auth-status' &&
      event.action.type === 'success'
    )
      invalidate()
  })
  return () => {
    changed?.()
    boundary?.()
    auth()
  }
}

export function useLinkedProfileEvents(): void {
  const client = useQueryClient()
  useEffect(() => subscribeLinkedProfiles(client), [client])
}
