import { describe, expect, it } from 'vitest'
import {
  DO_NOT_DISTURB_MS,
  alertsMuted,
  doNotDisturbAfterGames,
  doNotDisturbRemain,
  gateAlert,
  isDoNotDisturbActive,
  startDoNotDisturb
} from './doNotDisturb'

const HOUR = DO_NOT_DISTURB_MS['1h']
const NOW = 1_700_000_000_000

describe('isDoNotDisturbActive', () => {
  it('is off by default and after a timed choice expires', () => {
    expect(isDoNotDisturbActive('off', null, NOW)).toBe(false)
    expect(isDoNotDisturbActive('1h', NOW + HOUR, NOW)).toBe(true)
    expect(isDoNotDisturbActive('1h', NOW, NOW)).toBe(false)
    expect(isDoNotDisturbActive('3h', NOW - 1, NOW)).toBe(false)
    expect(isDoNotDisturbActive('1h', null, NOW)).toBe(false)
  })

  it('stays on for until-off with no deadline', () => {
    expect(isDoNotDisturbActive('until-off', null, NOW)).toBe(true)
  })
})

describe('alertsMuted', () => {
  it('suppresses every alert while Do not disturb is active and resumes after expiry', () => {
    const desktop: string[] = []
    const vr: string[] = []
    const deliver = (alert: string): void => {
      desktop.push(alert)
      vr.push(alert)
    }
    const active = gateAlert({
      muted: () =>
        alertsMuted({
          doNotDisturb: '1h',
          doNotDisturbUntil: NOW + HOUR,
          doNotDisturbFollowStatus: false,
          ownStatus: null,
          now: NOW
        }),
      deliver
    })
    active('friend')
    expect(desktop).toEqual([])
    expect(vr).toEqual([])

    const expired = gateAlert({
      muted: () =>
        alertsMuted({
          doNotDisturb: '1h',
          doNotDisturbUntil: NOW,
          doNotDisturbFollowStatus: false,
          ownStatus: null,
          now: NOW
        }),
      deliver
    })
    expired('friend')
    expect(desktop).toEqual(['friend'])
    expect(vr).toEqual(['friend'])
  })

  it('mutes while the signed-in VRChat status is Ask Me or Do Not Disturb, and only when that switch is on', () => {
    const base = {
      doNotDisturb: 'off' as const,
      doNotDisturbUntil: null,
      now: NOW
    }
    expect(alertsMuted({ ...base, doNotDisturbFollowStatus: true, ownStatus: 'dnd' })).toBe(true)
    expect(alertsMuted({ ...base, doNotDisturbFollowStatus: true, ownStatus: 'ask-me' })).toBe(true)
    expect(alertsMuted({ ...base, doNotDisturbFollowStatus: true, ownStatus: 'online' })).toBe(
      false
    )
    expect(alertsMuted({ ...base, doNotDisturbFollowStatus: true, ownStatus: null })).toBe(false)
    expect(alertsMuted({ ...base, doNotDisturbFollowStatus: false, ownStatus: 'dnd' })).toBe(false)
  })
})

describe('startDoNotDisturb', () => {
  it('stores a deadline for 1 hour and 3 hours, and none for until-off', () => {
    expect(startDoNotDisturb('1h', NOW)).toEqual({
      doNotDisturb: '1h',
      doNotDisturbUntil: NOW + DO_NOT_DISTURB_MS['1h']
    })
    expect(startDoNotDisturb('3h', NOW)).toEqual({
      doNotDisturb: '3h',
      doNotDisturbUntil: NOW + DO_NOT_DISTURB_MS['3h']
    })
    expect(startDoNotDisturb('until-off', NOW)).toEqual({
      doNotDisturb: 'until-off',
      doNotDisturbUntil: null
    })
    expect(startDoNotDisturb('off', NOW)).toEqual({
      doNotDisturb: 'off',
      doNotDisturbUntil: null
    })
  })
})

describe('doNotDisturbRemain', () => {
  it('reports the time left, and off once the deadline has passed', () => {
    expect(doNotDisturbRemain('until-off', null, NOW)).toEqual({ kind: 'until-off' })
    expect(doNotDisturbRemain('off', null, NOW)).toEqual({ kind: 'off' })
    expect(doNotDisturbRemain('1h', NOW + 30_000, NOW)).toEqual({ kind: 'under-a-minute' })
    expect(doNotDisturbRemain('1h', NOW + 90_000, NOW)).toEqual({ kind: 'minutes', count: 2 })
    expect(doNotDisturbRemain('3h', NOW + 3 * HOUR, NOW)).toEqual({ kind: 'hours', count: 3 })
    expect(doNotDisturbRemain('3h', NOW + 2 * HOUR + 5 * 60_000, NOW)).toEqual({
      kind: 'hours-minutes',
      hours: 2,
      minutes: 5
    })
    expect(doNotDisturbRemain('1h', NOW, NOW)).toEqual({ kind: 'off' })
  })
})

describe('doNotDisturbAfterGames', () => {
  it('ends Do not disturb when a game starts, and not when one was already running', () => {
    const baseline = doNotDisturbAfterGames({
      active: true,
      endOnGameStart: true,
      seen: null,
      running: new Set(['vrchat'])
    })
    expect(baseline).toEqual({ action: 'baseline', seen: new Set(['vrchat']) })

    expect(
      doNotDisturbAfterGames({
        active: true,
        endOnGameStart: true,
        seen: new Set(['vrchat']),
        running: new Set(['vrchat'])
      })
    ).toEqual({ action: 'keep', seen: new Set(['vrchat']) })

    expect(
      doNotDisturbAfterGames({
        active: true,
        endOnGameStart: true,
        seen: new Set(['vrchat']),
        running: new Set(['vrchat', 'chilloutvr'])
      }).action
    ).toBe('end')

    expect(
      doNotDisturbAfterGames({
        active: true,
        endOnGameStart: false,
        seen: null,
        running: new Set(['vrchat'])
      })
    ).toEqual({ action: 'ignore' })

    expect(
      doNotDisturbAfterGames({
        active: false,
        endOnGameStart: true,
        seen: new Set(),
        running: new Set(['vrchat'])
      })
    ).toEqual({ action: 'ignore' })

    expect(
      doNotDisturbAfterGames({
        active: true,
        endOnGameStart: true,
        seen: new Set(['vrchat']),
        running: null
      })
    ).toEqual({ action: 'unknown' })
  })

  it('ends when a game that had stopped starts again', () => {
    const stopped = doNotDisturbAfterGames({
      active: true,
      endOnGameStart: true,
      seen: new Set(['vrchat']),
      running: new Set()
    })
    expect(stopped).toEqual({ action: 'keep', seen: new Set() })
    expect(
      doNotDisturbAfterGames({
        active: true,
        endOnGameStart: true,
        seen: new Set(),
        running: new Set(['chilloutvr'])
      }).action
    ).toBe('end')
  })
})
