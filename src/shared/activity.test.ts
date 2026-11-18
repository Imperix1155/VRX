import { describe, expect, it } from 'vitest'
import { ACTIVITY_KEEP_DAYS, ACTIVITY_KEEP_FOR, deletesSavedHistory } from './activity'

describe('deletesSavedHistory', () => {
  it('is true exactly when the new choice keeps less than the current one', () => {
    // How much each choice keeps, in days; "until VRX closes" keeps nothing.
    const days = (choice: (typeof ACTIVITY_KEEP_FOR)[number]): number =>
      choice === 'session' ? 0 : (ACTIVITY_KEEP_DAYS[choice] ?? Infinity)
    for (const current of ACTIVITY_KEEP_FOR) {
      for (const next of ACTIVITY_KEEP_FOR) {
        expect(deletesSavedHistory(current, next), `${current} to ${next}`).toBe(
          days(next) < days(current)
        )
      }
    }
  })

  it('asks for "until VRX closes" from every saved choice, and never for the same choice', () => {
    expect(deletesSavedHistory('30d', 'session')).toBe(true)
    expect(deletesSavedHistory('forever', 'session')).toBe(true)
    expect(deletesSavedHistory('session', 'session')).toBe(false)
    expect(deletesSavedHistory('session', '30d')).toBe(false)
    expect(deletesSavedHistory('90d', '90d')).toBe(false)
  })
})
