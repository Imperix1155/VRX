/**
 * The rows a refreshed first page held while its list was open.
 *
 * A paged list shows a first page that follows main's change notice, then
 * older pages read on "Show older". The first page holds only the newest
 * rows, so each new row pushes the oldest one off it. With older pages
 * shown, that row is on neither: it would vanish from the middle of the
 * list, and "Show older" continues below it, so it would never come back.
 *
 * Every list built that way (the Activity list, the instance log) keeps its
 * first page's rows here and shows them between the first page and the older
 * pages. A row seen again is kept in its newest form.
 *
 * Every reset goes through `CarriedReset`, so a caller cannot drop these rows
 * without saying what happens to the page:
 *
 * - `replaced` (a Clear, a restore, another scope, another account) drops them
 *   and does not seed the page showing then. That page may be exactly what was
 *   just cleared. The next different page is the seed, so the caller publishes
 *   one (a new read, or the rows the clear left). The list still shows the
 *   current page for as long as that page does.
 * - `retained` (another Kept choice, while this page is still the list) drops
 *   them and seeds that same page, even when the array did not change. The
 *   next arrival then cannot drop a row that was never carried.
 *
 * When both change in one render, `replaced` wins: the page is about to be
 * replaced, and seeding it would keep rows the replacement discards.
 */
import { useState } from 'react'

export interface CarriedReset {
  replaced: string
  retained: string
}

interface Carried<T, K> {
  replaced: string
  retained: string
  /** The first page these rows were last taken from. */
  from: readonly T[] | undefined
  rows: ReadonlyMap<K, T>
}

function seedPage<T, K>(page: readonly T[] | undefined, keyOf: (row: T) => K): Map<K, T> {
  const rows = new Map<K, T>()
  if (page !== undefined) {
    for (const row of page) rows.set(keyOf(row), row)
  }
  return rows
}

export function useCarriedRows<T, K>(
  firstPage: readonly T[] | undefined,
  keyOf: (row: T) => K,
  reset: CarriedReset
): ReadonlyMap<K, T> {
  const [state, setState] = useState<Carried<T, K>>(() => ({
    replaced: reset.replaced,
    retained: reset.retained,
    from: undefined,
    rows: new Map()
  }))
  let next = state
  if (next.replaced !== reset.replaced) {
    next = {
      replaced: reset.replaced,
      retained: reset.retained,
      from: firstPage,
      rows: new Map()
    }
  } else if (next.retained !== reset.retained) {
    next = {
      replaced: reset.replaced,
      retained: reset.retained,
      from: firstPage,
      rows: seedPage(firstPage, keyOf)
    }
  } else if (next.from !== firstPage) {
    let rows = next.rows
    if (firstPage !== undefined && firstPage.length > 0) {
      const added = new Map(rows)
      for (const row of firstPage) added.set(keyOf(row), row)
      rows = added
    }
    next = { replaced: reset.replaced, retained: reset.retained, from: firstPage, rows }
  }
  // Adjusted while rendering, so the list never paints a frame without them.
  if (next !== state) setState(next)
  return next.rows
}
