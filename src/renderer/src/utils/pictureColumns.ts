/**
 * Picture card columns by content width. Mirrors the `.picture-grid` and
 * `.hot-grid--picture` container queries in `main.css` (a test keeps the two
 * in step): one column below 440 px, two up to 1,480 px, then one more each
 * time a column would pass about 730 px, up to eight.
 */
export const PICTURE_COLUMN_STEPS = [440, 1480, 2200, 2920, 3640, 4360, 5080] as const

export function pictureColumns(width: number): number {
  let columns = 1
  for (const step of PICTURE_COLUMN_STEPS) if (width >= step) columns += 1
  return columns
}

/**
 * How many picture cards to show so the rows come out full (owner,
 * 2026-11-01: no half-empty rows on wide screens). At least `wanted`, rounded
 * up to whole rows; the caller still stops at the cards it actually has.
 */
export function fillRows(wanted: number, columns: number): number {
  const perRow = Math.max(1, Math.floor(columns))
  return Math.max(wanted, Math.ceil(wanted / perRow) * perRow)
}
