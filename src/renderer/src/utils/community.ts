/**
 * Pure helpers shared by the Search, Groups, Explore list and profile views.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import type { CommunityFailure } from '@shared/community'
import type { AuthStatus, Platform } from '@shared/types'
import { isNotConnectedAuth } from '../hooks/useNotConnectedGate'

export type CommunityNoticeReason = CommunityFailure | 'cooldown' | 'invalid-query'

/** What one platform's part of a page shows right now. */
export type CommunitySource<T> =
  | { kind: 'idle' | 'auth-pending' | 'not-connected' | 'loading' }
  | { kind: 'failed'; reason: CommunityNoticeReason }
  | { kind: 'ready'; result: T }

type Answer = { ok: true } | { ok: false; reason: string }

const NOTICE_REASONS: readonly CommunityNoticeReason[] = [
  'not-authenticated',
  'rate-limited',
  'unavailable',
  'cooldown',
  'invalid-query'
]

function noticeReason(reason: string): CommunityNoticeReason {
  return (NOTICE_REASONS as readonly string[]).includes(reason)
    ? (reason as CommunityNoticeReason)
    : 'unavailable'
}

/** One platform's state from its auth query and its community query. */
export function communitySource<T extends Answer>(
  auth: Pick<UseQueryResult<AuthStatus, Error>, 'data' | 'isPending' | 'isSuccess' | 'isFetching'>,
  query: Pick<UseQueryResult<T, Error>, 'data' | 'isError' | 'fetchStatus'>
): CommunitySource<Extract<T, { ok: true }>> {
  if (auth.data === undefined && auth.isPending) return { kind: 'auth-pending' }
  if (isNotConnectedAuth(auth)) return { kind: 'not-connected' }
  const result = query.data
  if (result === undefined) {
    if (query.isError) return { kind: 'failed', reason: 'unavailable' }
    return query.fetchStatus === 'fetching' ? { kind: 'loading' } : { kind: 'idle' }
  }
  return result.ok
    ? { kind: 'ready', result: result as Extract<T, { ok: true }> }
    : { kind: 'failed', reason: noticeReason(result.reason) }
}

/**
 * Alternate the platforms' lists (first of each, then second of each, …) so
 * one platform's results never bury the other's in a mixed list. Each list
 * keeps its platform's own order (search relevance, newest first).
 */
export function interleave<T>(lists: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index]
      if (item !== undefined) out.push(item)
    }
  }
  return out
}

/** The platforms a page shows under the top bar's filter. */
export function shownPlatforms(filter: Platform | 'all'): Platform[] {
  return filter === 'all' ? ['vrchat', 'chilloutvr'] : [filter]
}

/** The platform's display name, through the shared Dashboard keys. */
export function platformName(t: (key: string) => string, platform: Platform): string {
  return t(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
}
