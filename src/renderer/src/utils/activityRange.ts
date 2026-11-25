/**
 * The Activity page's date presets, as local calendar days. The first and
 * last moment of a day count. "Last 7 days" and "Last 30 days" include today.
 */
export const ACTIVITY_DATE_PRESETS = ['today', '7d', '30d', 'all', 'custom'] as const
export type ActivityDatePreset = (typeof ACTIVITY_DATE_PRESETS)[number]

export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function endOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime()
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

/** `YYYY-MM-DD` as a local calendar day, or undefined when it is not one. */
function parseLocalDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined
  }
  return date
}

/** Inclusive bounds for the preset. Custom dates that are reversed are swapped. */
export function activityDateBounds(
  preset: ActivityDatePreset,
  now: Date,
  customFrom: string,
  customTo: string
): { from?: number; to?: number } {
  if (preset === 'today') return { from: startOfLocalDay(now), to: endOfLocalDay(now) }
  if (preset === '7d') return { from: startOfLocalDay(shiftDays(now, -6)), to: endOfLocalDay(now) }
  if (preset === '30d') {
    return { from: startOfLocalDay(shiftDays(now, -29)), to: endOfLocalDay(now) }
  }
  if (preset !== 'custom') return {}
  const fromDate = parseLocalDay(customFrom)
  const toDate = parseLocalDay(customTo)
  let from = fromDate === undefined ? undefined : startOfLocalDay(fromDate)
  let to = toDate === undefined ? undefined : endOfLocalDay(toDate)
  if (
    from !== undefined &&
    to !== undefined &&
    from > to &&
    fromDate !== undefined &&
    toDate !== undefined
  ) {
    from = startOfLocalDay(toDate)
    to = endOfLocalDay(fromDate)
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to })
  }
}
