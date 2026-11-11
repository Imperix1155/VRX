import { afterEach, describe, expect, it, vi } from 'vitest'
import { coalesce, delayed } from './coalesce'

afterEach(() => {
  vi.useRealTimers()
})

describe('coalesce', () => {
  it('runs once after a burst pauses, at most every max wait while it lasts, and not after cancel', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const read = coalesce(run, 100, 1_000)
    for (let i = 0; i < 50; i += 1) read.trigger()
    vi.advanceTimersByTime(99)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)

    for (let t = 0; t <= 1_000; t += 50) {
      read.trigger()
      vi.advanceTimersByTime(50)
    }
    expect(run).toHaveBeenCalledTimes(2)

    read.cancel()
    vi.advanceTimersByTime(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    read.trigger()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe('delayed', () => {
  it('holds one run at a time with the delay it was given, and drops it on cancel', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const read = delayed(run)

    expect(read.schedule(100)).toBe(true)
    // A second request while one waits changes nothing.
    expect(read.schedule(10)).toBe(false)
    vi.advanceTimersByTime(99)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)

    expect(read.schedule(500)).toBe(true)
    read.cancel()
    vi.advanceTimersByTime(1_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(read.schedule(50)).toBe(true)
    vi.advanceTimersByTime(50)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
