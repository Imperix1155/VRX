import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_KEEP_DAYS,
  ACTIVITY_KEEP_FOR,
  activityLikePattern,
  activitySearchText,
  deletesSavedHistory,
  matchesActivityListQuery
} from './activity'

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

const row = {
  displayName: 'Alice',
  previousName: 'Allie',
  worldName: 'Night Market',
  platform: 'vrchat' as const,
  at: 1_000
}

describe('matchesActivityListQuery', () => {
  it('matches a name, an earlier name, a world and a platform, and ignores letter case', () => {
    expect(matchesActivityListQuery(row, { text: 'ali' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'ALLIE' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'night' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'VRChat' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'vrc' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'cvr' })).toBe(false)
    expect(matchesActivityListQuery({ ...row, platform: 'chilloutvr' }, { text: 'CVR' })).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'bob' })).toBe(false)
  })

  it('matches a current or earlier name saved for the same friend', () => {
    expect(matchesActivityListQuery(row, { text: 'robert' }, ['Robert'])).toBe(true)
    expect(matchesActivityListQuery(row, { text: 'carol' }, ['Carol Once'])).toBe(true)
  })

  it('treats the search characters %, _ and \\ as ordinary text', () => {
    expect(activitySearchText('  Night  ')).toBe('Night')
    expect(activitySearchText('   ')).toBeNull()
    expect(activityLikePattern('100%_\\')).toBe('%100\\%\\_\\\\%')
    expect(matchesActivityListQuery({ ...row, displayName: '100%' }, { text: '%' })).toBe(true)
    expect(matchesActivityListQuery({ ...row, displayName: 'Alice' }, { text: '%' })).toBe(false)
  })

  it('includes the first and last moment and excludes the ones outside', () => {
    expect(matchesActivityListQuery(row, { from: 1_000, to: 1_000 })).toBe(true)
    expect(matchesActivityListQuery(row, { from: 1_000 })).toBe(true)
    expect(matchesActivityListQuery(row, { to: 1_000 })).toBe(true)
    expect(matchesActivityListQuery(row, { from: 1_001 })).toBe(false)
    expect(matchesActivityListQuery(row, { to: 999 })).toBe(false)
    expect(matchesActivityListQuery(row, undefined)).toBe(true)
  })
})
