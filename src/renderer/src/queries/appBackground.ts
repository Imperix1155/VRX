import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { AppBackgroundResult } from '@shared/ipc'

/** Installation-wide, never persisted (only the friends namespace is). */
export const appBackgroundKey = ['app-background'] as const

export type AppBackgroundData = { dataUrl: string } | null

function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.vrx?.getAppBackground === 'function'
}

/** The user's own background picture, read once from main. */
export function useAppBackground(): UseQueryResult<AppBackgroundData, Error> {
  return useQuery({
    queryKey: appBackgroundKey,
    queryFn: async (): Promise<AppBackgroundData> => {
      if (!window.vrx) throw new Error('unavailable')
      return (await window.vrx.getAppBackground()) ?? null
    },
    staleTime: Infinity,
    retry: false,
    refetchOnReconnect: false,
    // Local IPC: never pause while the browser reports offline.
    networkMode: 'always',
    enabled: bridgeAvailable()
  })
}

/** Open main's picture dialog and adopt the kept copy. Bridge failures read as `unreadable`. */
export async function chooseAppBackground(client: QueryClient): Promise<AppBackgroundResult> {
  let result: AppBackgroundResult
  try {
    if (!window.vrx) throw new Error('unavailable')
    result = await window.vrx.chooseAppBackground()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (result.ok) {
    const next: AppBackgroundData = { dataUrl: result.dataUrl }
    client.setQueryData(appBackgroundKey, next)
  }
  return result
}

/** Forget the picture. Resolves false when main could not remove it. */
export async function clearAppBackground(client: QueryClient): Promise<boolean> {
  try {
    if (!window.vrx) throw new Error('unavailable')
    await window.vrx.clearAppBackground()
  } catch {
    return false
  }
  const next: AppBackgroundData = null
  client.setQueryData(appBackgroundKey, next)
  return true
}
