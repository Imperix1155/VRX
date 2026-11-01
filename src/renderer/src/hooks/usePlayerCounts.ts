/**
 * Everyone playing each platform right now, for the top bar's counts
 * (owner, 2026-11-01). Read when VRX opens and again on a page switch once the
 * last answer is 5 minutes old; never on a timer, window focus or reconnect
 * (docs/api-policy.md). Main also caches each answer for 5 minutes.
 */
import { useEffect, useRef } from 'react'
import { COMMUNITY_CACHE_MS } from '@shared/community'
import type { Platform } from '@shared/types'
import { usePlayersOnline } from '../queries/community'

export interface PlayerCount {
  platform: Platform
  count: number
}

/**
 * Everyone playing each shown platform. `refreshKey` is the active page: a
 * change re-reads an answer that is at least 5 minutes old.
 */
export function usePlayerCounts(
  platforms: readonly Platform[],
  enabled: boolean,
  refreshKey: string
): PlayerCount[] {
  const vrc = usePlayersOnline('vrchat', enabled && platforms.includes('vrchat'))
  const cvr = usePlayersOnline('chilloutvr', enabled && platforms.includes('chilloutvr'))
  // The latest queries for the page-switch effect, which must not rerun on
  // every answer.
  const queries = useRef({ vrc, cvr })
  useEffect(() => {
    queries.current = { vrc, cvr }
  })

  const lastKey = useRef(refreshKey)
  useEffect(() => {
    if (lastKey.current === refreshKey) return
    lastKey.current = refreshKey
    for (const query of [queries.current.vrc, queries.current.cvr]) {
      if (
        query.data !== undefined &&
        query.fetchStatus === 'idle' &&
        Date.now() - query.dataUpdatedAt >= COMMUNITY_CACHE_MS
      ) {
        void query.refetch()
      }
    }
  }, [refreshKey])

  if (!enabled) return []
  return (
    [
      ['vrchat', vrc.data],
      ['chilloutvr', cvr.data]
    ] as const
  ).flatMap(([platform, result]) =>
    platforms.includes(platform) && result?.ok ? [{ platform, count: result.count }] : []
  )
}
