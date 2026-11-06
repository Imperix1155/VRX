/**
 * The inbox (owner, 2026-10-27): invites, invite requests and friend
 * requests the sockets delivered while VRX was open. Main owns the rows; the
 * renderer reads them after each `inbox-changed` push and hides rows in VRX
 * here; answering a friend request is `friendActions.ts`. Never persisted
 * (only the friends namespace is).
 */
import { useContext, useEffect, useState } from 'react'
import {
  QueryClient,
  QueryClientContext,
  useQuery,
  useQueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import type { InboxSnapshot } from '@shared/inbox'
import type { Platform } from '@shared/types'

export const inboxKey = ['inbox'] as const

const EMPTY: InboxSnapshot = { items: [] }

function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.vrx?.getInbox === 'function'
}

export function useInbox(): UseQueryResult<InboxSnapshot, Error> {
  // The sidebar count renders in tests and the guide without a provider.
  const provided = useContext(QueryClientContext)
  const [fallback] = useState(() => new QueryClient())
  return useQuery(
    {
      queryKey: inboxKey,
      queryFn: async (): Promise<InboxSnapshot> => {
        if (!window.vrx) throw new Error('unavailable')
        return (await window.vrx.getInbox()) ?? EMPTY
      },
      staleTime: Infinity,
      retry: false,
      refetchOnReconnect: false,
      // Local IPC: never pause while the browser reports offline.
      networkMode: 'always',
      enabled: bridgeAvailable()
    },
    provided ?? fallback
  )
}

/** App-wide: each main push re-reads the inbox. Mounted once by `App`. */
export function useInboxEvents(): void {
  const client = useQueryClient()
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.onInboxChanged !== 'function') return
    return window.vrx.onInboxChanged(() => {
      void client.invalidateQueries({ queryKey: inboxKey })
    })
  }, [client])
}

/** Hide one row in VRX. Main pushes the change; a failed call changes nothing. */
export async function dismissInboxItem(platform: Platform, id: string): Promise<boolean> {
  try {
    if (!window.vrx) return false
    await window.vrx.dismissInboxItem({ platform, id })
    return true
  } catch {
    return false
  }
}

/** Hide every row for these platforms, in VRX only. */
export async function clearInbox(platforms: Platform[]): Promise<boolean> {
  if (platforms.length === 0) return true
  try {
    if (!window.vrx) return false
    await window.vrx.clearInbox({ platforms })
    return true
  } catch {
    return false
  }
}
