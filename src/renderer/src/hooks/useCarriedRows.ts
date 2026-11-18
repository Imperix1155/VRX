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
 * A new `resetKey` drops them: a Clear, a restore, another scope, another
 * account. What the first page holds at that moment is not kept either, since
 * it may be exactly what was just cleared or replaced; the list still shows it
 * for as long as the first page does.
 */
import { useState } from 'react'

interface Carried<T, K> {
  resetKey: string
  /** The first page these rows were last taken from. */
  from: readonly T[] | undefined
  rows: ReadonlyMap<K, T>
}

export function useCarriedRows<T, K>(
  firstPage: readonly T[] | undefined,
  keyOf: (row: T) => K,
  resetKey: string
): ReadonlyMap<K, T> {
  const [state, setState] = useState<Carried<T, K>>(() => ({
    resetKey,
    from: undefined,
    rows: new Map()
  }))
  let next = state
  if (next.resetKey !== resetKey) {
    next = { resetKey, from: firstPage, rows: new Map() }
  } else if (next.from !== firstPage) {
    let rows = next.rows
    if (firstPage !== undefined && firstPage.length > 0) {
      const added = new Map(rows)
      for (const row of firstPage) added.set(keyOf(row), row)
      rows = added
    }
    next = { resetKey, from: firstPage, rows }
  }
  // Adjusted while rendering, so the list never paints a frame without them.
  if (next !== state) setState(next)
  return next.rows
}
