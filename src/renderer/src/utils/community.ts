/**
 * Pure helpers shared by the Search, Groups, Explore list and profile views.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import type { CommunityFailure } from '@shared/community'
import type { AuthStatus, Platform } from '@shared/types'
import { isNotConnectedAuth } from '../hooks/useNotConnectedGate'

export type CommunityNoticeReason = CommunityFailure | 'cooldown' | 'invalid-query'

/**
 * What one platform's part of a page shows right now. `stale` still shows the
 * answer that loaded last, because a later read of it failed.
 */
export type CommunitySource<T> =
  | { kind: 'idle' | 'auth-pending' | 'not-connected' | 'loading' }
  | { kind: 'failed'; reason: CommunityNoticeReason }
  | { kind: 'ready' | 'stale'; result: T }

/** A cached answer; `refreshFailed` marks a loaded one whose later read failed. */
export type Kept<T> = T & { readonly refreshFailed?: true }

type Answer = Kept<{ ok: true } | { ok: false; reason: string }>

/**
 * A later read that fails (a Refresh, or a re-read when the page opens again)
 * never replaces what already loaded: the last good answer stays, marked
 * `refreshFailed`, and the page says so in a dim line (DESIGN.md §9.4). A good
 * answer replaces it; a failure with nothing loaded yet stays a failure.
 */
export function keepShown<T extends { ok: boolean }>(
  previous: Kept<T> | undefined,
  next: T
): Kept<T> {
  if (next.ok || previous?.ok !== true) return next
  return { ...previous, refreshFailed: true }
}

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
  // A failure being asked again (Try again, Search) reads as loading until
  // the platform answers, so a second refusal never looks like nothing happened.
  if (result?.ok !== true && query.fetchStatus === 'fetching') return { kind: 'loading' }
  if (result === undefined) {
    return query.isError ? { kind: 'failed', reason: 'unavailable' } : { kind: 'idle' }
  }
  if (!result.ok) return { kind: 'failed', reason: noticeReason(result.reason) }
  return {
    kind: result.refreshFailed === true ? 'stale' : 'ready',
    result: result as Extract<T, { ok: true }>
  }
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
