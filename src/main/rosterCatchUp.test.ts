import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AdapterEvent, Platform } from '@shared/types'
import { RosterCatchUp } from './rosterCatchUp'

function rig(readResult: () => Promise<unknown> = () => Promise.resolve()): {
  catchUp: RosterCatchUp
  window: { open: boolean }
  readRoster: Mock<(platform: Platform) => Promise<unknown>>
  logFailure: Mock<(platform: Platform) => void>
} {
  const window = { open: false }
  const readRoster = vi.fn<(platform: Platform) => Promise<unknown>>(readResult)
  const logFailure = vi.fn<(platform: Platform) => void>()
  const catchUp = new RosterCatchUp({ hasWindow: () => window.open, readRoster, logFailure })
  return { catchUp, window, readRoster, logFailure }
}

const live = (platform: Platform): AdapterEvent => ({
  type: 'connection',
  platform,
  health: 'live'
})

describe('RosterCatchUp', () => {
  it('reads the roster once on a reconnect while no window is open', () => {
    const r = rig()
    r.catchUp.consume(live('vrchat'))
    r.catchUp.consume(live('chilloutvr'))
    expect(r.readRoster.mock.calls).toEqual([['vrchat'], ['chilloutvr']])
  })

  it('leaves the read to an open window, so no read is ever added', () => {
    const r = rig()
    r.window.open = true
    r.catchUp.consume(live('vrchat'))
    expect(r.readRoster).not.toHaveBeenCalled()
  })

  it('reads only on live', () => {
    const r = rig()
    const events: AdapterEvent[] = [
      { type: 'connection', platform: 'vrchat', health: 'reconnecting' },
      { type: 'connection', platform: 'vrchat', health: 'down' },
      { type: 'roster-changed', platform: 'chilloutvr' },
      { type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' },
      { type: 'presence-snapshot', platform: 'chilloutvr', entries: [] }
    ]
    for (const event of events) r.catchUp.consume(event)
    expect(r.readRoster).not.toHaveBeenCalled()
  })

  it('after a failed session check, waits for a roster read that works', () => {
    const r = rig()
    r.catchUp.consume({ type: 'auth-invalidated', platform: 'vrchat' })

    // A socket can open before the server turns the stale session away.
    r.catchUp.consume(live('vrchat'))
    r.catchUp.consume(live('chilloutvr'))
    expect(r.readRoster.mock.calls).toEqual([['chilloutvr']])

    // The window signed in again and its read worked.
    r.catchUp.rosterRead('vrchat')
    r.catchUp.consume(live('vrchat'))
    expect(r.readRoster.mock.calls).toEqual([['chilloutvr'], ['vrchat']])
  })

  it('logs a failed read by platform only and never throws', async () => {
    const r = rig(() => Promise.reject(new Error('roster boom')))
    r.logFailure.mockImplementation(() => {
      throw new Error('log boom')
    })
    expect(() => r.catchUp.consume(live('chilloutvr'))).not.toThrow()
    await vi.waitFor(() => expect(r.logFailure).toHaveBeenCalledExactlyOnceWith('chilloutvr'))
  })
})
