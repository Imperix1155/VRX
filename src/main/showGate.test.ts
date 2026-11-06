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

  it('says whether it has shown the window, so a focus request can leave a new one to it', () => {
    vi.useFakeTimers()
    const gate = createShowGate({ timeoutMs: 3_000, onShow: vi.fn(), onTimeout: vi.fn() })

    expect(gate.isShown()).toBe(false)
    gate.hydrated()
    gate.ready()
    expect(gate.isShown()).toBe(true)

    const late = createShowGate({ timeoutMs: 3_000, onShow: vi.fn(), onTimeout: vi.fn() })
    late.ready()
    expect(late.isShown()).toBe(false)
    vi.advanceTimersByTime(3_000)
    expect(late.isShown()).toBe(true)
  })

  it('shows a requested window that never says it can paint, after the timeout', () => {
    vi.useFakeTimers()
    const onShow = vi.fn()
    const onTimeout = vi.fn()
    const gate = createShowGate({ timeoutMs: 3_000, onShow, onTimeout })

    gate.hydrated()
    vi.advanceTimersByTime(60_000)
    expect(onShow).not.toHaveBeenCalled()

    gate.requested()
    gate.requested()
    vi.advanceTimersByTime(2_999)
    expect(onShow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onShow).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(gate.isShown()).toBe(true)
  })

  it('keeps a request’s fallback running when the window says it can paint later', () => {
    vi.useFakeTimers()
    const onShow = vi.fn()
    const gate = createShowGate({ timeoutMs: 3_000, onShow, onTimeout: vi.fn() })

    gate.requested()
    vi.advanceTimersByTime(2_000)
    gate.ready()
    vi.advanceTimersByTime(1_000)
    expect(onShow).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(10_000)
    expect(onShow).toHaveBeenCalledOnce()
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
