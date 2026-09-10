import { API_REQUEST_MIN_INTERVAL_MS } from '@shared/constants'
import { RateLimitError, RequestCancelledError, RequestQueueFullError } from './errors'

export type RequestPriority = 'default' | 'interactive' | 'background'

// One VRC roster can produce twenty concurrent metadata reads. CVR socket
// snapshots have no cardinality cap, so reserve capacity for explicit actions
// rather than allowing background fan-out to allocate an unlimited queue.
export const API_MAX_PENDING_ADMISSIONS = 256
const INTERACTIVE_RESERVED_ADMISSIONS = 16
export const MAX_ADMISSION_SLEEP_MS = 2_147_483_647
const MAX_BACKOFF_MS = 30_000

export interface AdmissionOptions {
  priority?: RequestPriority
  signal?: AbortSignal
  notBefore?: number
  /** Batch work stops at cooldown instead of sleeping and replaying it later. */
  rejectOnCooldown?: boolean
}

export interface AdmissionClock {
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  /** CDN cooldown controllers use zero spacing; their body semaphore is separate. */
  minimumIntervalMs?: number
  maxPending?: number
}

interface Waiter {
  options: AdmissionOptions
  resolve: () => void
  reject: (error: unknown) => void
  removeAbort: () => void
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new RequestCancelledError())
      return
    }
    const abort = (): void => {
      clearTimeout(timer)
      reject(new RequestCancelledError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Parse server waits without treating malformed or overflowing numbers as timers. */
export function retryAfterDelayMs(header: string | null, now: number): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && Number.isFinite(now + delay) ? delay : null
  }
  if (!/[a-z,]/i.test(value)) return null
  const deadline = Date.parse(value)
  return Number.isFinite(deadline) && deadline >= now ? deadline - now : null
}

/** One main-owned admission queue per platform, with no credentials or I/O. */
export class ApiAdmissionController {
  private readonly now: () => number
  private readonly sleep: NonNullable<AdmissionClock['sleep']>
  private readonly random: () => number
  private readonly minimumInterval: number
  private readonly maxPending: number
  private readonly waiters: Waiter[] = []
  private nextStart = 0
  private cooldown = 0
  private failures = 0
  private rateLimitGeneration = 0
  private dispatching = false
  private wake: AbortController | null = null

  constructor(clock: AdmissionClock = {}) {
    this.now = clock.now ?? Date.now
    this.sleep = clock.sleep ?? sleep
    this.random = clock.random ?? Math.random
    this.minimumInterval = clock.minimumIntervalMs ?? API_REQUEST_MIN_INTERVAL_MS
    this.maxPending = clock.maxPending ?? API_MAX_PENDING_ADMISSIONS
  }

  get cooldownUntil(): number {
    return this.cooldown
  }

  get cooldownRemainingMs(): number {
    return Math.max(0, this.cooldown - this.now())
  }

  get pendingCount(): number {
    return this.waiters.length
  }

  /** Changes on every 429, even when its wait is zero, to revoke resolved batch permits. */
  get rateLimitRevision(): number {
    return this.rateLimitGeneration
  }

  acquire(options: AdmissionOptions = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new RequestCancelledError())
    if (options.rejectOnCooldown && this.cooldownRemainingMs > 0) {
      return Promise.reject(new RateLimitError(this.cooldownRemainingMs))
    }
    const capacity =
      options.priority === 'interactive'
        ? this.maxPending
        : Math.max(
            1,
            this.maxPending - Math.min(INTERACTIVE_RESERVED_ADMISSIONS, this.maxPending - 1)
          )
    if (this.waiters.length >= capacity) return Promise.reject(new RequestQueueFullError())
    if (options.notBefore !== undefined && !Number.isFinite(options.notBefore)) {
      return Promise.reject(new Error('Invalid admission deadline'))
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { options, resolve, reject, removeAbort: () => {} }
      const abort = (): void => {
        const index = this.waiters.indexOf(waiter)
        if (index < 0) return
        this.waiters.splice(index, 1)
        waiter.removeAbort()
        reject(new RequestCancelledError())
        this.wake?.abort()
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      waiter.removeAbort = () => options.signal?.removeEventListener('abort', abort)
      this.waiters.push(waiter)
      this.wake?.abort()
      if (!this.dispatching) void this.dispatch()
    })
  }

  deferUntil(deadline: number): void {
    if (!Number.isFinite(deadline)) throw new Error('Invalid cooldown deadline')
    this.cooldown = Math.max(this.cooldown, deadline)
    if (this.cooldownRemainingMs > 0) this.rejectBatchAdmissions()
    this.wake?.abort()
  }

  /** Returns the shared deadline, including any longer wait from an older response. */
  rateLimited(retryAfter: string | null): number {
    this.rateLimitGeneration += 1
    const delay =
      retryAfterDelayMs(retryAfter, this.now()) ??
      Math.min(1_000 * 2 ** Math.min(this.failures, 15), MAX_BACKOFF_MS)
    this.failures += 1
    this.deferUntil(this.now() + delay + this.jitter())
    // A 429 ends queued batches even when Retry-After and jitter are both zero.
    // The deadline controls when fresh work may start, not whether this batch failed.
    this.rejectBatchAdmissions()
    return this.cooldown
  }

  private rejectBatchAdmissions(): void {
    for (const waiter of [...this.waiters]) {
      if (!waiter.options.rejectOnCooldown) continue
      this.waiters.splice(this.waiters.indexOf(waiter), 1)
      waiter.removeAbort()
      waiter.reject(new RateLimitError(this.cooldownRemainingMs))
    }
  }

  succeeded(): void {
    // A late success from before a 429 must not reset escalating fallback waits.
    if (this.cooldownRemainingMs === 0) this.failures = 0
  }

  private jitter(): number {
    return Math.floor(this.random() * 100)
  }

  private nextWaiter(): Waiter | undefined {
    return (
      this.waiters.find(({ options }) => options.notBefore !== undefined) ??
      this.waiters.find(({ options }) => options.priority === 'interactive') ??
      this.waiters.find(({ options }) => options.priority !== 'background') ??
      this.waiters[0]
    )
  }

  private async dispatch(): Promise<void> {
    this.dispatching = true
    try {
      while (this.waiters.length > 0) {
        const waiter = this.nextWaiter()!
        const now = this.now()
        const start = Math.max(now, this.nextStart, this.cooldown, waiter.options.notBefore ?? 0)
        if (start > now) {
          const wake = new AbortController()
          this.wake = wake
          try {
            // Long Retry-After values must never overflow Node's timer to 1 ms.
            // A wake only triggers recalculation; it never proves admission.
            await this.sleep(Math.min(start - now, MAX_ADMISSION_SLEEP_MS), wake.signal)
          } catch (error) {
            if (!wake.signal.aborted) throw error
          } finally {
            if (this.wake === wake) this.wake = null
          }
          continue
        }
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.removeAbort()
        if (waiter.options.signal?.aborted) {
          waiter.reject(new RequestCancelledError())
          continue
        }
        this.nextStart = now + this.minimumInterval + (this.minimumInterval > 0 ? this.jitter() : 0)
        waiter.resolve()
      }
    } catch (error) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.removeAbort()
        waiter.reject(error)
      }
    } finally {
      this.wake = null
      this.dispatching = false
    }
  }
}
