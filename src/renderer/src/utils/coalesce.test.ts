import { afterEach, describe, expect, it, vi } from 'vitest'
import { coalesce } from './coalesce'

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
