import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  InstanceVisit,
  InstanceVisitPage,
  InstanceVisitPageRequest,
  InstanceVisitPerson
} from '@shared/instanceLog'
import type { Platform } from '@shared/types'
import { useAppliedKeepFor } from '../hooks/useAppliedKeepFor'
import { useCarriedRows } from '../hooks/useCarriedRows'

/** Not persisted in the renderer: main saves the instance log itself. */
export const instanceLogKey = ['instance-log'] as const

/** One page of the rooms the user was in, straight from main. Local only: it
 *  reads this computer's history, never a platform. */
export async function fetchInstanceVisits(
  request: InstanceVisitPageRequest
): Promise<InstanceVisitPage> {
  if (typeof window.vrx?.getInstanceVisits !== 'function') return { visits: [], hasMore: false }
  return window.vrx.getInstanceVisits(request)
}

/** What tells one visit from another across both platforms. */
export const visitKey = (visit: InstanceVisit): string => `${visit.platform}:${visit.id}`

/** Newest first; a visit read twice (a refreshed first page and an older
 *  page) is listed once, in the form of the first list that holds it. */
export function mergeVisits(...lists: ReadonlyArray<Iterable<InstanceVisit>>): InstanceVisit[] {
  const byKey = new Map<string, InstanceVisit>()
  for (const list of lists) {
    for (const visit of list) {
      const key = visitKey(visit)
      if (!byKey.has(key)) byKey.set(key, visit)
    }
  }
  return [...byKey.values()].sort((a, b) => b.enteredAt - a.enteredAt || b.id - a.id)
}

export interface InstanceVisitsView {
  visits: InstanceVisit[]
  /** False until the first page has answered. */
  ready: boolean
  failed: boolean
  canShowOlder: boolean
  olderFailed: boolean
  showOlder: () => void
  retry: () => void
  /** Forget what is shown and read again (after a Clear). */
  startOver: () => void
}

interface OlderPages {
  key: string
  visits: InstanceVisit[]
  hasMore: boolean | null
  busy: boolean
  failed: boolean
}

/**
 * The instance log for the platforms in the filter. The first page follows
 * main's change notice; older pages are read on Show older. A visit a newer
 * one pushed off the first page stays listed (`useCarriedRows`). All of it
 * starts over when the scope or an account changes, when main applied another
 * Kept choice (`useAppliedKeepFor`) and on `startOver`, so one account's rooms
 * never stay on screen for another and nothing deleted stays listed.
 */
export function useInstanceVisits(
  platforms: readonly Platform[],
  enabled: boolean
): InstanceVisitsView {
  const client = useQueryClient()
  const [resets, setResets] = useState(0)
  useEffect(
    () =>
      window.vrx?.onIdentityBoundary?.(() => {
        setResets((count) => count + 1)
        void client.invalidateQueries({ queryKey: instanceLogKey })
      }),
    [client]
  )
  // A Kept choice main applied may have deleted saved visits.
  const keptFor = useAppliedKeepFor()
  const key = `${platforms.join('+')}|${resets}|${keptFor}`
  const first = useQuery({
    queryKey: [...instanceLogKey, 'visits', key],
    queryFn: () =>
      fetchInstanceVisits({ scope: platforms.map((platform) => ({ platform, before: null })) }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    enabled
  })
  const [older, setOlder] = useState<OlderPages>({
    key,
    visits: [],
    hasMore: null,
    busy: false,
    failed: false
  })
  if (older.key !== key) {
    setOlder({ key, visits: [], hasMore: null, busy: false, failed: false })
  }
  const firstVisits = first.data?.visits
  // `key` is also the query key, so a Kept change, Clear or account change
  // replaces this page with a new read. Retention is named too: if a later
  // edit stops replacing the page, the same choice still reseeds it.
  const carried = useCarriedRows(firstVisits, visitKey, { replaced: key, retained: keptFor })
  const visits = useMemo(
    () => mergeVisits(firstVisits ?? [], carried.values(), older.key === key ? older.visits : []),
    [firstVisits, carried, older, key]
  )

  const showOlder = useCallback((): void => {
    if (older.busy || older.key !== key) return
    setOlder((current) => ({ ...current, busy: true, failed: false }))
    // Each platform continues from its own oldest visit shown.
    const scope = platforms.map((platform) => {
      const mine = visits.filter((visit) => visit.platform === platform)
      return {
        platform,
        before: mine.length === 0 ? null : Math.min(...mine.map((visit) => visit.enteredAt))
      }
    })
    fetchInstanceVisits({ scope }).then(
      (page) =>
        setOlder((current) =>
          current.key !== key
            ? current
            : {
                key,
                visits: mergeVisits(current.visits, page.visits),
                hasMore: page.hasMore,
                busy: false,
                failed: false
              }
        ),
      () =>
        setOlder((current) =>
          current.key !== key ? current : { ...current, busy: false, failed: true }
        )
    )
  }, [older.busy, older.key, key, platforms, visits])

  return {
    visits,
    ready: first.data !== undefined,
    failed: first.isError,
    canShowOlder: (older.key === key ? older.hasMore : null) ?? first.data?.hasMore ?? false,
    olderFailed: older.failed,
    showOlder,
    retry: () => {
      if (first.isError) void first.refetch()
      else showOlder()
    },
    startOver: () => setResets((count) => count + 1)
  }
}

/** Who was there during one visit; read when its row is opened. */
export function useVisitPeople(
  platform: Platform,
  visitId: number,
  enabled: boolean
): { people: InstanceVisitPerson[] | undefined; failed: boolean } {
  const query = useQuery({
    queryKey: [...instanceLogKey, 'people', platform, visitId],
    queryFn: async () => {
      if (typeof window.vrx?.getInstanceVisitPeople !== 'function') return []
      return window.vrx.getInstanceVisitPeople({ platform, visitId })
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    enabled
  })
  return { people: query.data, failed: query.isError }
}

/** Clear the instance log for these platforms in main; every view reads again. */
export async function clearInstanceLog(client: QueryClient, platforms: Platform[]): Promise<void> {
  if (typeof window.vrx?.clearInstanceLog !== 'function') return
  await window.vrx.clearInstanceLog({ platforms })
  await client.invalidateQueries({ queryKey: instanceLogKey })
}
