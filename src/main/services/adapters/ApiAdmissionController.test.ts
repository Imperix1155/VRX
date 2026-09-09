import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiAdmissionController,
  MAX_ADMISSION_SLEEP_MS,
  retryAfterDelayMs
} from './ApiAdmissionController'
import { RateLimitError, RequestCancelledError, RequestQueueFullError } from './errors'

describe('ApiAdmissionController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('paces a queue after cooldown and keeps the other platform independent', async () => {
    const first = new ApiAdmissionController({ random: () => 0 })
    const other = new ApiAdmissionController({ random: () => 0 })
    first.deferUntil(70_000)
    const starts: number[] = []
    const pending = Array.from({ length: 3 }, () =>
      first.acquire().then(() => starts.push(Date.now()))
    )
    await expect(other.acquire()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(2_001)
    await Promise.all(pending)
    expect(starts).toEqual([70_000, 71_000, 72_000])
  })

  it('gives interactive work the next legal slot ahead of image backlog', async () => {
    const admission = new ApiAdmissionController({ random: () => 0 })
    await admission.acquire()
    const order: string[] = []
    const image = admission.acquire({ priority: 'background' }).then(() => order.push('image'))
    const normal = admission.acquire().then(() => order.push('normal'))
    const action = admission.acquire({ priority: 'interactive' }).then(() => order.push('action'))
    await vi.advanceTimersByTimeAsync(3_000)
    await Promise.all([image, normal, action])
    expect(order).toEqual(['action', 'normal', 'image'])
  })

  it('terminates queued batch admissions on a cooldown while retaining explicit work', async () => {
    const admission = new ApiAdmissionController({ random: () => 0 })
    await admission.acquire()
    const batches = Array.from({ length: 3 }, () =>
      admission.acquire({ rejectOnCooldown: true }).catch((error: unknown) => error)
    )
    let explicitStarted = false
    const explicit = admission.acquire({ priority: 'interactive' }).then(() => {
      explicitStarted = true
    })
    admission.rateLimited('60')
    expect(await Promise.all(batches)).toEqual(
      Array.from({ length: 3 }, () => expect.any(RateLimitError))
    )
    expect(admission.pendingCount).toBe(1)
    await expect(admission.acquire({ rejectOnCooldown: true })).rejects.toBeInstanceOf(
      RateLimitError
    )
    await vi.advanceTimersByTimeAsync(59_999)
    expect(explicitStarted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await explicit
    expect(explicitStarted).toBe(true)
    expect(admission.pendingCount).toBe(0)
  })

  it('extends cooldown monotonically when in-flight responses disagree', async () => {
    const admission = new ApiAdmissionController({ random: () => 0 })
    admission.rateLimited('60')
    let admitted = false
    const pending = admission.acquire().then(() => {
      admitted = true
    })
    await vi.advanceTimersByTimeAsync(30_000)
    admission.rateLimited('60')
    admission.rateLimited('1')
    expect(admission.cooldownUntil).toBe(100_000)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(admitted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(admitted).toBe(true)
  })

  it.each(['0', 'Thu, 01 Jan 1970 00:00:10 GMT'])(
    'ends queued batches for immediate Retry-After %s without dropping explicit work',
    async (retryAfter) => {
      const admission = new ApiAdmissionController({ random: () => 0 })
      await admission.acquire()
      const controller = new AbortController()
      const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
      const starts: number[] = []
      const batches = Array.from({ length: 3 }, () =>
        admission.acquire({ rejectOnCooldown: true, signal: controller.signal }).then(
          () => starts.push(Date.now()),
          (error: unknown) => error
        )
      )
      const explicit = admission
        .acquire({ priority: 'interactive' })
        .then(() => starts.push(Date.now()))
      admission.rateLimited(retryAfter)
      expect(admission.cooldownRemainingMs).toBe(0)
      expect(admission.pendingCount).toBe(1)
      expect(await Promise.all(batches)).toEqual(
        Array.from({ length: 3 }, () => expect.any(RateLimitError))
      )
      expect(removeAbort).toHaveBeenCalledTimes(3)
      // Fresh caller-owned work is still eligible; the failed batch is not replayed.
      const fresh = admission
        .acquire({ rejectOnCooldown: true })
        .then(() => starts.push(Date.now()))
      await vi.advanceTimersByTimeAsync(10_000)
      await Promise.all([explicit, fresh])
      expect(starts).toEqual([11_000, 12_000])
      expect(admission.pendingCount).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('uses growing fallback across operations and ignores late success during cooldown', async () => {
    const admission = new ApiAdmissionController({ random: () => 0.5 })
    admission.rateLimited(null)
    expect(admission.cooldownRemainingMs).toBe(1_050)
    admission.succeeded()
    await vi.advanceTimersByTimeAsync(1_050)
    admission.rateLimited('invalid')
    expect(admission.cooldownRemainingMs).toBe(2_050)
    await vi.advanceTimersByTimeAsync(2_050)
    admission.succeeded()
    admission.rateLimited(null)
    expect(admission.cooldownRemainingMs).toBe(1_050)
  })

  it('does not convert a server wait beyond Node timer range into immediate admission', async () => {
    const admission = new ApiAdmissionController({ random: () => 0 })
    const delay = MAX_ADMISSION_SLEEP_MS + 5_000
    admission.deferUntil(Date.now() + delay)
    const starts: number[] = []
    const pending = admission.acquire().then(() => starts.push(Date.now()))
    await vi.advanceTimersByTimeAsync(MAX_ADMISSION_SLEEP_MS)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(starts).toEqual([10_000 + delay])
  })

  it('rejects overflow once while reserving capacity for actions and drains cancelled waits', async () => {
    const admission = new ApiAdmissionController({ random: () => 0, maxPending: 4 })
    admission.deferUntil(70_000)
    const controller = new AbortController()
    const background = admission
      .acquire({ signal: controller.signal })
      .catch((error: unknown) => error)
    await expect(admission.acquire()).rejects.toBeInstanceOf(RequestQueueFullError)
    const actions = Array.from({ length: 3 }, () =>
      admission
        .acquire({ priority: 'interactive', signal: controller.signal })
        .catch((error: unknown) => error)
    )
    await expect(admission.acquire({ priority: 'interactive' })).rejects.toBeInstanceOf(
      RequestQueueFullError
    )
    expect(admission.pendingCount).toBe(4)
    controller.abort()
    const errors = await Promise.all([background, ...actions])
    expect(errors.every((error) => error instanceof RequestCancelledError)).toBe(true)
    expect(admission.pendingCount).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    await expect(admission.acquire({ signal: controller.signal })).rejects.toBeInstanceOf(
      RequestCancelledError
    )
  })

  it('rechecks the clock after an early wake instead of trusting sleep completion', async () => {
    let clock = 10_000
    const sleep = vi.fn(async (ms: number) => {
      clock += sleep.mock.calls.length === 1 ? ms - 1 : ms
    })
    const admission = new ApiAdmissionController({ now: () => clock, sleep, random: () => 0 })
    await admission.acquire()
    await admission.acquire()
    expect(sleep.mock.calls).toEqual([
      [1_000, expect.any(AbortSignal)],
      [1, expect.any(AbortSignal)]
    ])
    expect(clock).toBe(11_000)
  })

  it.each([null, '', '-1', 'invalid', '2 seconds', '9'.repeat(400)])(
    'rejects malformed Retry-After %j',
    (header) => {
      expect(retryAfterDelayMs(header, Date.now())).toBeNull()
    }
  )

  it('reads seconds and HTTP dates without capping valid long server waits', () => {
    expect(retryAfterDelayMs(' 60 ', 0)).toBe(60_000)
    expect(retryAfterDelayMs('Thu, 01 Jan 1970 00:01:00 GMT', 0)).toBe(60_000)
    expect(retryAfterDelayMs('2147484', 0)).toBe(2_147_484_000)
  })
})
