import { describe, expect, it } from 'vitest'
import { activityDateBounds } from './activityRange'

describe('activityDateBounds', () => {
  const now = new Date(2026, 5, 15, 15, 30, 0)

  it('includes today from the first moment through the last', () => {
    expect(activityDateBounds('today', now, '', '')).toEqual({
      from: new Date(2026, 5, 15).getTime(),
      to: new Date(2026, 5, 15, 23, 59, 59, 999).getTime()
    })
  })

  it('counts today in the last 7 and last 30 calendar days', () => {
    expect(activityDateBounds('7d', now, '', '').from).toBe(new Date(2026, 5, 9).getTime())
    expect(activityDateBounds('30d', now, '', '').from).toBe(new Date(2026, 4, 17).getTime())
    expect(activityDateBounds('7d', now, '', '').to).toBe(
      new Date(2026, 5, 15, 23, 59, 59, 999).getTime()
    )
  })

  it('leaves All unbounded and reads custom dates inclusively', () => {
    expect(activityDateBounds('all', now, '2026-01-01', '2026-02-01')).toEqual({})
    expect(activityDateBounds('custom', now, '2026-06-01', '2026-06-02')).toEqual({
      from: new Date(2026, 5, 1).getTime(),
      to: new Date(2026, 5, 2, 23, 59, 59, 999).getTime()
    })
    expect(activityDateBounds('custom', now, '2026-06-02', '2026-06-01')).toEqual({
      from: new Date(2026, 5, 1).getTime(),
      to: new Date(2026, 5, 2, 23, 59, 59, 999).getTime()
    })
    expect(activityDateBounds('custom', now, '2026-06-01', '')).toEqual({
      from: new Date(2026, 5, 1).getTime()
    })
    expect(activityDateBounds('custom', now, 'nope', '2026-02-31')).toEqual({})
  })
})
