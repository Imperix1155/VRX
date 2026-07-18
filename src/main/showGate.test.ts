import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShowGate } from './showGate'

afterEach(() => {
  vi.useRealTimers()
})

describe('createShowGate', () => {
  it.each([
    ['ready then hydrated', ['ready', 'hydrated']],
    ['hydrated then ready', ['hydrated', 'ready']]
  ] as const)('shows once after both signals: %s', (_label, signals) => {
    const onShow = vi.fn()
    const gate = createShowGate({ timeoutMs: 3_000, onShow, onTimeout: vi.fn() })

    gate[signals[0]]()
    expect(onShow).not.toHaveBeenCalled()
    gate[signals[1]]()

    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('shows on timeout after ready when hydration never arrives', () => {
    vi.useFakeTimers()
    const onShow = vi.fn()
    const onTimeout = vi.fn()
    const gate = createShowGate({ timeoutMs: 3_000, onShow, onTimeout })

    gate.ready()
    vi.advanceTimersByTime(2_999)
    expect(onShow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onShow).toHaveBeenCalledTimes(1)

    gate.hydrated()
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('never shows twice after duplicate signals or a later timeout', () => {
    vi.useFakeTimers()
    const onShow = vi.fn()
    const onTimeout = vi.fn()
    const gate = createShowGate({ timeoutMs: 3_000, onShow, onTimeout })

    gate.ready()
    gate.hydrated()
    gate.ready()
    gate.hydrated()
    vi.runAllTimers()

    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
