import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { WAKE_RECONNECT_COALESCE_MS, reconnectLiveOnWake } from './wakeReconnect'

function rig(): {
  power: EventEmitter
  vrchat: { reconnectNow: ReturnType<typeof vi.fn> }
  chilloutvr: { reconnectNow: ReturnType<typeof vi.fn> }
  clock: { now: number }
  logFailure: ReturnType<typeof vi.fn>
  stop: () => void
} {
  const power = new EventEmitter()
  const vrchat = { reconnectNow: vi.fn() }
  const chilloutvr = { reconnectNow: vi.fn() }
  const clock = { now: 1_000_000 }
  const logFailure = vi.fn()
  const stop = reconnectLiveOnWake(power, [vrchat, chilloutvr], {
    now: () => clock.now,
    logFailure
  })
  return { power, vrchat, chilloutvr, clock, logFailure, stop }
}

describe('reconnectLiveOnWake', () => {
  it('asks both platforms to reconnect on resume', () => {
    const r = rig()
    r.power.emit('resume')
    expect(r.vrchat.reconnectNow).toHaveBeenCalledOnce()
    expect(r.chilloutvr.reconnectNow).toHaveBeenCalledOnce()
  })

  it('ignores a screen unlock, which keeps the connection up', () => {
    const r = rig()
    r.power.emit('unlock-screen')
    expect(r.vrchat.reconnectNow).not.toHaveBeenCalled()
    expect(r.chilloutvr.reconnectNow).not.toHaveBeenCalled()
  })

  it('counts resumes close together once, and a later wake again', () => {
    const r = rig()
    r.power.emit('resume')
    r.clock.now += 5_000
    r.power.emit('resume')
    expect(r.vrchat.reconnectNow).toHaveBeenCalledOnce()
    r.clock.now += WAKE_RECONNECT_COALESCE_MS
    r.power.emit('resume')
    expect(r.vrchat.reconnectNow).toHaveBeenCalledTimes(2)
    expect(r.chilloutvr.reconnectNow).toHaveBeenCalledTimes(2)
  })

  it('still reconnects the other platform when one throws', () => {
    const r = rig()
    r.vrchat.reconnectNow.mockImplementation(() => {
      throw new Error('fixture')
    })
    r.power.emit('resume')
    expect(r.chilloutvr.reconnectNow).toHaveBeenCalledOnce()
    expect(r.logFailure).toHaveBeenCalledOnce()
  })

  it('stops listening after teardown', () => {
    const r = rig()
    r.stop()
    r.power.emit('resume')
    expect(r.vrchat.reconnectNow).not.toHaveBeenCalled()
    expect(r.power.listenerCount('resume')).toBe(0)
  })
})
