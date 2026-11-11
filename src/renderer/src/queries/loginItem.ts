/**
 * Start with your computer: what the operating system's startup list says
 * (main's `get-login-item`), so Settings can tell the user when their choice
 * did not take. Local IPC only. Read after the setting has been saved, never
 * while a save is still on its way, so the answer is about the saved choice.
 */
import { useContext, useState } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import type { LoginItemStatus } from '@shared/ipc'
import type { StartWithComputer } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

export const loginItemQueryKey = ['login-item'] as const

/** What Settings says under the row, or null when the computer matches the choice. */
export type LoginItemProblem = 'not-applied' | 'still-on' | 'unavailable'

function parseStatus(value: unknown): LoginItemStatus | null {
  return value === 'on' || value === 'off' || value === 'unavailable' ? value : null
}

/** Pure: the mismatch between the saved choice and the computer, if any. */
export function loginItemProblem(
  choice: StartWithComputer,
  status: LoginItemStatus | null
): LoginItemProblem | null {
  if (status === null) return null
  const wanted = choice !== 'off'
  if (status === 'unavailable') return wanted ? 'unavailable' : null
  if (wanted && status === 'off') return 'not-applied'
  if (!wanted && status === 'on') return 'still-on'
  return null
}

export function useLoginItemProblem(choice: StartWithComputer): LoginItemProblem | null {
  const provided = useContext(QueryClientContext)
  const [fallback] = useState(() => new QueryClient())
  const unsaved = useSettingsStore((s) => s.dirty || s.saving)
  const { data } = useQuery(
    {
      // Keyed by the choice: a new choice never shows the last one's answer.
      queryKey: [...loginItemQueryKey, choice],
      queryFn: async (): Promise<LoginItemStatus | null> => {
        const getLoginItem = window.vrx?.getLoginItem
        if (!getLoginItem) return null
        try {
          return parseStatus(await getLoginItem())
        } catch {
          return null
        }
      },
      enabled:
        !unsaved && typeof window !== 'undefined' && typeof window.vrx?.getLoginItem === 'function',
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchOnReconnect: false,
      networkMode: 'always'
    },
    provided ?? fallback
  )
  return unsaved ? null : loginItemProblem(choice, data ?? null)
}
