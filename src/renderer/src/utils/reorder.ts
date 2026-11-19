/**
 * Pure maths for dragging one item of a vertical list to a new place (quick
 * reorder; owner, 2026-11-15). `useDragReorder` measures the rows once when a
 * drag starts and asks these helpers where things go while the pointer moves.
 */

/** A row's place in the window when the drag began. */
export interface RowBox {
  top: number
  height: number
}

/** The space between two neighbouring rows; 0 for a single row. */
export function rowGap(rows: readonly RowBox[]): number {
  const [first, second] = rows
  if (!first || !second) return 0
  return Math.max(0, second.top - (first.top + first.height))
}

/** Keeps the dragged row inside the list: it never leaves the first or last slot. */
export function clampDrag(rows: readonly RowBox[], from: number, dy: number): number {
  const row = rows[from]
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (!row || !first || !last) return 0
  const min = first.top - row.top
  const max = last.top + last.height - (row.top + row.height)
  return Math.min(max, Math.max(min, dy))
}

/**
 * Where the dragged row would land. A row above gives way once the dragged
 * row's top edge passes its middle; a row below once the bottom edge does.
 * Works for rows of different heights.
 */
export function dropIndex(rows: readonly RowBox[], from: number, dy: number): number {
  const row = rows[from]
  if (!row) return from
  const top = row.top + dy
  const bottom = top + row.height
  let index = from
  rows.forEach((other, i) => {
    const middle = other.top + other.height / 2
    if (i < from && top < middle) index -= 1
    if (i > from && bottom > middle) index += 1
  })
  return index
}

/** How far row `index` steps aside (px) while row `from` hovers over slot `to`. */
export function rowShift(rows: readonly RowBox[], from: number, to: number, index: number): number {
  const row = rows[from]
  if (!row || index === from) return 0
  const step = row.height + rowGap(rows)
  if (index < from && index >= to) return step
  if (index > from && index <= to) return -step
  return 0
}

/** `items` with the entry at `from` moved to `to`. Out-of-range moves change nothing. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
