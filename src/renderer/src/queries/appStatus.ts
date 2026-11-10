/**
 * Main's own connection health for the top bar's status dot. It is local IPC
 * that never reaches either platform, so a short poll is safe; a hidden window
 * (closed to the tray) skips it and reads again as soon as it shows. Every
 * socket change also arrives as a push, which `useLiveFriendEvents` (mounted by
 * `App`) writes here at once with `setConnectionHealth`, so the dot follows it
 * instead of waiting up to one poll.
 */
import { useContext, useState } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import type { ConnectionHealth, Platform } from '@shared/types'

export const APP_STATUS_POLL_MS = 7_500

export const appStatusQueryKey = ['app-status'] as const

export type ConnectionHealthByPlatform = Readonly<Record<Platform, ConnectionHealth>>

/** What the dot shows before main has answered, or when its answer is unreadable. */
const UNKNOWN_HEALTH: ConnectionHealthByPlatform = { vrchat: 'down', chilloutvr: 'down' }

export function parseConnectionHealth(value: unknown): ConnectionHealth {
  return value === 'live' || value === 'reconnecting' || value === 'down' ? value : 'down'
}

async function readConnectionHealth(): Promise<ConnectionHealthByPlatform> {
  const getAppStatus = window.vrx?.getAppStatus
  if (!getAppStatus) return UNKNOWN_HEALTH
  try {
    const status: unknown = await getAppStatus()
    if (typeof status !== 'object' || status === null || !('ws' in status)) return UNKNOWN_HEALTH
    const ws: unknown = status.ws
    if (typeof ws !== 'object' || ws === null) return UNKNOWN_HEALTH
    return {
      vrchat: parseConnectionHealth('vrchat' in ws ? ws.vrchat : undefined),
      chilloutvr: parseConnectionHealth('chilloutvr' in ws ? ws.chilloutvr : undefined)
    }
  } catch {
    return UNKNOWN_HEALTH
  }
}

/** Each platform's socket health, as main last reported it. */
export function useConnectionHealth(): ConnectionHealthByPlatform {
  const provided = useContext(QueryClientContext)
  const [fallback] = useState(() => new QueryClient())
  const { data } = useQuery(
    {
      queryKey: appStatusQueryKey,
      queryFn: readConnectionHealth,
      refetchInterval: APP_STATUS_POLL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: false,
      // Local IPC: never pause while the browser reports offline.
      networkMode: 'always'
    },
    provided ?? fallback
  )
  return data ?? UNKNOWN_HEALTH
}

/** A pushed socket change; keeps the same object when nothing changed. */
export function setConnectionHealth(
  queryClient: QueryClient,
  platform: Platform,
  health: unknown
): void {
  const next = parseConnectionHealth(health)
  queryClient.setQueryData<ConnectionHealthByPlatform>(appStatusQueryKey, (current) => {
    const base = current ?? UNKNOWN_HEALTH
    return base[platform] === next ? base : { ...base, [platform]: next }
  })
}
