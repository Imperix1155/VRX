/**
 * Older saved activity, a page at a time (owner, 2026-11-15). The Activity
 * page uses it below its live list and a friend's History uses it for the
 * whole list. It reads this computer's history through main and never a
 * platform.
 *
 * The next page is read ahead, so Show older appears only when there is
 * something to show and shows it at once. A restart (`restartKey` changed)
 * drops everything read so far; an answer for an older run is ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityEntry,
  ActivityFilter,
  ActivityFriendRef,
  ActivityListQuery,
  ActivityPageCursor
} from '@shared/activity'
import { fetchActivityPage } from '../queries/activity'
import { advanceCursors } from '../utils/activityPaging'

/** Pages read in a row that held nothing new before the reader waits for a press. */
const MAX_EMPTY_PAGES = 4

export type ActivityPagerStatus = 'idle' | 'loading' | 'failed'

export interface ActivityPagerOptions {
  /** A new value starts over: the scope, the account, a Clear. */
  restartKey: string
  /** Where to start on each platform. Empty means nothing older exists. */
  start: readonly ActivityPageCursor[]
  filter: ActivityFilter
  friends?: readonly ActivityFriendRef[]
  /** Search and dates. Absent reads the scope as it stands. */
  query?: ActivityListQuery
  /** Ids shown elsewhere (the live list): never counted as something new. */
  known?: ReadonlySet<number>
  /** Show the first page without a press (a friend's History). */
  revealFirst?: boolean
}

export interface ActivityPager {
  /** Older entries shown so far, newest first. */
  entries: ActivityEntry[]
  /** A page is ready, or more may exist: show the Show older button. */
  canShowOlder: boolean
  showOlder: () => void
  status: ActivityPagerStatus
  /** The first read has finished (or there was nothing to read). */
  ready: boolean
  retry: () => void
}

interface PagerState {
  key: string
  entries: ActivityEntry[]
  /** Read ahead, not shown yet. */
  next: ActivityEntry[] | null
  /** More pages may exist after `next`. */
  more: boolean
  status: ActivityPagerStatus
  ready: boolean
}

function emptyState(key: string): PagerState {
  return { key, entries: [], next: null, more: false, status: 'idle', ready: false }
}

export function useActivityPager(options: ActivityPagerOptions): ActivityPager {
  const { restartKey, start, filter, friends, query, known, revealFirst = false } = options
  const [state, setState] = useState<PagerState>(() => emptyState(restartKey))
  // A restart shows the empty state in the same render, before any effect.
  if (state.key !== restartKey) setState(emptyState(restartKey))
  const current = state.key === restartKey ? state : emptyState(restartKey)

  /** Each run of the reader has its own number; a late answer is dropped. */
  const run = useRef(0)
  const cursors = useRef<ActivityPageCursor[]>([])
  const reading = useRef(false)
  const latest = useRef({ filter, friends, known, start, query })
  useEffect(() => {
    latest.current = { filter, friends, known, start, query }
  })

  /** Read ahead until a page holds something new, or nothing older is left. */
  const readAhead = useCallback(async (key: string, reveal: boolean): Promise<void> => {
    if (reading.current || cursors.current.length === 0) return
    const mine = run.current
    reading.current = true
    setState((prev) => (prev.key === key ? { ...prev, status: 'loading' } : prev))
    try {
      let found: ActivityEntry[] = []
      let more = true
      for (let attempt = 0; more && found.length === 0 && attempt < MAX_EMPTY_PAGES; attempt++) {
        const requested = latest.current.query
        const page = await fetchActivityPage({
          scope: cursors.current,
          filter: latest.current.filter,
          ...(latest.current.friends === undefined ? {} : { friends: [...latest.current.friends] }),
          ...(requested === undefined ? {} : { query: requested })
        })
        if (mine !== run.current) return
        cursors.current = advanceCursors(cursors.current, page.entries)
        more = page.hasMore
        const shown = latest.current.known
        found =
          shown === undefined ? page.entries : page.entries.filter((entry) => !shown.has(entry.id))
      }
      setState((prev) => {
        if (prev.key !== key) return prev
        const seen = new Set(prev.entries.map((entry) => entry.id))
        const fresh = found.filter((entry) => !seen.has(entry.id))
        return reveal
          ? {
              ...prev,
              entries: [...prev.entries, ...fresh],
              next: null,
              more,
              status: 'idle',
              ready: true
            }
          : { ...prev, next: fresh, more, status: 'idle', ready: true }
      })
    } catch {
      if (mine !== run.current) return
      setState((prev) => (prev.key === key ? { ...prev, status: 'failed', ready: true } : prev))
    } finally {
      if (mine === run.current) reading.current = false
    }
  }, [])

  // Start over whenever the key changes, from wherever `start` points now.
  useEffect(() => {
    run.current += 1
    reading.current = false
    cursors.current = [...latest.current.start]
    void readAhead(restartKey, revealFirst)
  }, [restartKey, revealFirst, readAhead])

  // Once a page is shown, keep the one after it read ahead, so the button
  // knows whether to stay.
  const needsAhead =
    current.ready && current.status === 'idle' && current.next === null && current.more
  useEffect(() => {
    if (needsAhead) void readAhead(restartKey, false)
  }, [needsAhead, restartKey, readAhead])

  const showOlder = useCallback((): void => {
    setState((prev) => {
      if (prev.key !== restartKey || prev.next === null) return prev
      return { ...prev, entries: [...prev.entries, ...prev.next], next: null }
    })
  }, [restartKey])

  const showsNothingYet = current.entries.length === 0
  const retry = useCallback((): void => {
    void readAhead(restartKey, revealFirst && showsNothingYet)
  }, [restartKey, revealFirst, showsNothingYet, readAhead])

  const nextCount = current.next?.length ?? 0
  return {
    entries: current.entries,
    // A page is waiting, or the reader stopped after several pages that held
    // nothing new and more are left.
    canShowOlder: nextCount > 0 || (current.next !== null && current.more),
    showOlder,
    status: current.status,
    // With nowhere to start there is nothing to wait for.
    ready: current.ready || start.length === 0,
    retry
  }
}
