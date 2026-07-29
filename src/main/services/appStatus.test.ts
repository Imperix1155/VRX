import { describe, expect, it } from 'vitest'
import { AppStatusService } from './appStatus'

describe('AppStatusService', () => {
  it('defaults both platform connections to down before any live event', () => {
    const status = new AppStatusService()

    expect(status.snapshot()).toEqual({
      ws: { vrchat: 'down', chilloutvr: 'down' },
      lastReconcileAt: { vrchat: null, chilloutvr: null }
    })
  })

  it('records known connection health and degrades unknown values to down', () => {
    const status = new AppStatusService()

    status.recordConnection('vrchat', 'live')
    status.recordConnection('chilloutvr', 'reconnecting')
    expect(status.snapshot().ws).toEqual({
      vrchat: 'live',
      chilloutvr: 'reconnecting'
    })

    status.recordConnection('vrchat', 'future-health')
    expect(status.snapshot().ws.vrchat).toBe('down')
  })

  it('stamps successful reconciles independently with the injected clock', () => {
    let now = 1_000
    const status = new AppStatusService(() => now)

    status.recordReconcile('vrchat')
    now = 2_500
    status.recordReconcile('chilloutvr')

    expect(status.snapshot().lastReconcileAt).toEqual({
      vrchat: 1_000,
      chilloutvr: 2_500
    })
  })

  it('returns defensive snapshots that callers cannot mutate', () => {
    const status = new AppStatusService()
    const first = status.snapshot()

    first.ws.vrchat = 'live'
    first.lastReconcileAt.vrchat = 42

    expect(status.snapshot()).toEqual({
      ws: { vrchat: 'down', chilloutvr: 'down' },
      lastReconcileAt: { vrchat: null, chilloutvr: null }
    })
  })
})
