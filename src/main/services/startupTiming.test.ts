import { describe, expect, it } from 'vitest'
import { StartupTiming } from './startupTiming'

describe('StartupTiming', () => {
  it('measures process creation to window ready and first render, once', () => {
    const timing = new StartupTiming()
    timing.rememberProcessStart(1_000)
    timing.noteWindowReady(1_842)
    timing.noteFirstRender(1_910)
    timing.noteWindowReady(9_000)
    timing.noteFirstRender(9_000)
    timing.rememberProcessStart(2_000)

    expect(timing.snapshot()).toEqual({ windowReadyMs: 842, firstRenderMs: 910 })
  })

  it('stays empty until a real process start is known', () => {
    const timing = new StartupTiming()
    timing.rememberProcessStart(Number.NaN)
    timing.rememberProcessStart(0)
    timing.noteWindowReady(1_000)
    timing.noteFirstRender(1_000)

    expect(timing.snapshot()).toEqual({ windowReadyMs: null, firstRenderMs: null })
  })
})
