import { z } from 'zod'
import { API_REQUEST_MIN_INTERVAL_MS, API_TIMEOUT_MS } from '@shared/constants'
import type {
  AdapterEvent,
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  JoinMode,
  LoginResult,
  Platform
} from '@shared/types'
import type { IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'
import { AuthError, NetworkError, RateLimitError } from './errors'

const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_429_RETRIES = 3
const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_RESET_MS = 60_000

export type RequestPriority = 'default' | 'interactive'

export interface AdapterRequestOptions {
  priority?: RequestPriority
  recordCircuitFailure?: boolean
}

interface RequestWaiter {
  resolve: () => void
  reject: (error: unknown) => void
  notBefore: number
}

function jitter(): number {
  return Math.floor(Math.random() * 100)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Abstract base class for platform adapters (VRX-17).
 *
 * Provides `protected request<T>()` with: a priority-aware dispatcher that
 * preserves the 1 req/sec + jitter wire ceiling, AbortSignal.timeout,
 * redirect:'error', 429 exponential backoff (honors Retry-After), Zod
 * validation, and a circuit breaker (opens after 3 consecutive non-429
 * failures; resets on success or after CIRCUIT_RESET_MS).
 *
 * Pass a custom `sleepFn` in tests to skip real timers.
 */
export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform

  private readonly sleep: (ms: number) => Promise<void>
  private nextRequestAt = 0
  private nextRetryAt = 0
  private cooldownUntil = 0
  private dispatchingRequests = false
  private wakeDispatcher: (() => void) | null = null
  private readonly retryWaiters: RequestWaiter[] = []
  private readonly interactiveWaiters: RequestWaiter[] = []
  private readonly defaultWaiters: RequestWaiter[] = []
  private consecutiveFailures = 0
  private lastFailureAt = 0

  protected constructor(sleepFn: (ms: number) => Promise<void> = defaultSleep) {
    this.sleep = sleepFn
  }

  /**
   * Low-level request: priority-aware rate limiting (1 req/sec + jitter),
   * AbortSignal.timeout, redirect:'error', 429 backoff/retry, and the circuit
   * breaker — returning the raw `Response` WITHOUT interpreting its status or
   * body. Non-429 statuses (200/401/500/…) come back as-is for the caller to
   * interpret; only a thrown fetch (network failure) records a circuit failure.
   *
   * Auth flows use this directly so a 401 is a clean "wrong password" result —
   * NOT an `AuthError` plus a circuit-breaker lockout after 3 wrong attempts.
   */
  protected async rawRequest(
    url: string,
    options: RequestInit = {},
    { recordCircuitFailure = true, priority = 'default' }: AdapterRequestOptions = {}
  ): Promise<Response> {
    if (
      this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - this.lastFailureAt < CIRCUIT_RESET_MS
    ) {
      throw new NetworkError('Circuit open: too many consecutive failures')
    }
    return this.attemptRaw(url, options, 0, null, recordCircuitFailure, priority)
  }

  private async attemptRaw(
    url: string,
    options: RequestInit,
    retryCount: number,
    reservedRetryAt: number | null,
    recordCircuitFailure: boolean,
    priority: RequestPriority
  ): Promise<Response> {
    await this.waitForRequestSlot(priority, reservedRetryAt)

    let response: Response
    try {
      response = await fetch(url, {
        ...options,
        // Security: never follow redirects (prevents SSRF-like open-redirect
        // attacks from a compromised API endpoint).
        redirect: 'error',
        // Override any caller-supplied signal so the timeout is always enforced.
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      })
    } catch (err) {
      if (recordCircuitFailure) this.recordFailure()
      throw new NetworkError('Request failed', err)
    }

    // 429 — backoff and retry; 429s are not circuit-breaker events.
    if (response.status === 429) {
      const delay = this.rateLimitDelay(response, retryCount)
      if (retryCount >= MAX_429_RETRIES) {
        this.applyCooldown(delay, false)
        throw new RateLimitError(delay)
      }
      const retryAt = this.applyCooldown(delay, true)
      return this.attemptRaw(url, options, retryCount + 1, retryAt, recordCircuitFailure, priority)
    }

    return response
  }

  /**
   * Typed request: `rawRequest` + status/JSON/Zod interpretation. A non-2xx
   * response (401/403 → `AuthError`, else `NetworkError`), an unparseable body,
   * or a schema mismatch records a circuit failure; a fully-validated response
   * resets it.
   */
  protected async request<T>(
    url: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
    { priority = 'default' }: Pick<AdapterRequestOptions, 'priority'> = {}
  ): Promise<T> {
    const response = await this.rawRequest(url, options, { priority })

    if (response.status === 401 || response.status === 403) {
      this.recordFailure()
      throw new AuthError(undefined, response.status)
    }

    if (!response.ok) {
      this.recordFailure()
      throw new NetworkError(`HTTP ${response.status}`)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      this.recordFailure()
      throw new NetworkError('Failed to parse response body')
    }

    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      this.recordFailure()
      throw new NetworkError(`Response validation failed: ${parsed.error.message}`)
    }

    this.consecutiveFailures = 0
    return parsed.data
  }

  private recordFailure(): void {
    this.consecutiveFailures++
    this.lastFailureAt = Date.now()
  }

  /**
   * Clear the circuit breaker. For a DELIBERATE user action (an interactive
   * login) that must always reach the wire: background/data-call failures can
   * open the shared breaker, and a user typing correct credentials should not
   * be fast-failed as "cannot connect" for the reset window (VRX-190/VRX-189).
   * Rate limiting (1 req/sec) and 429 backoff still protect the API.
   */
  protected resetCircuit(): void {
    this.consecutiveFailures = 0
  }

  private waitForRequestSlot(
    priority: RequestPriority,
    reservedRetryAt: number | null
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, notBefore: reservedRetryAt ?? 0 }
      const queue =
        reservedRetryAt !== null
          ? this.retryWaiters
          : priority === 'interactive'
            ? this.interactiveWaiters
            : this.defaultWaiters
      queue.push(waiter)
      if (!this.dispatchingRequests) {
        void this.dispatchRequestQueue()
      } else if (reservedRetryAt !== null) {
        const wake = this.wakeDispatcher
        this.wakeDispatcher = null
        wake?.()
      }
    })
  }

  private async sleepUntilScheduleChanges(ms: number): Promise<boolean> {
    let wake: (() => void) | undefined
    const scheduleChanged = new Promise<void>((resolve) => {
      wake = resolve
      this.wakeDispatcher = resolve
    })
    const result = await Promise.race([
      this.sleep(ms).then(() => false),
      scheduleChanged.then(() => true)
    ])
    if (this.wakeDispatcher === wake) this.wakeDispatcher = null
    return result
  }

  private async dispatchRequestQueue(): Promise<void> {
    this.dispatchingRequests = true
    try {
      while (
        this.retryWaiters.length > 0 ||
        this.interactiveWaiters.length > 0 ||
        this.defaultWaiters.length > 0
      ) {
        const retryIsNext = this.retryWaiters.length > 0
        const nextWaiter = retryIsNext
          ? this.retryWaiters[0]
          : (this.interactiveWaiters[0] ?? this.defaultWaiters[0])
        if (nextWaiter === undefined) continue
        const now = Date.now()
        const requestAt = Math.max(
          now,
          retryIsNext ? this.nextRetryAt : this.nextRequestAt,
          this.cooldownUntil,
          nextWaiter.notBefore
        )
        if (requestAt > now && (await this.sleepUntilScheduleChanges(requestAt - now))) {
          continue
        }

        // A 429 from any in-flight request can extend the shared cooldown while
        // this dispatcher is asleep. Recalculate the full schedule before
        // admitting anyone. Reserved retries stay FIFO ahead of new work, and
        // their own retryAt remains a lower bound if the cooldown moves again.
        const retryIsStillNext = this.retryWaiters.length > 0
        const recheckedWaiter = retryIsStillNext
          ? this.retryWaiters[0]
          : (this.interactiveWaiters[0] ?? this.defaultWaiters[0])
        if (recheckedWaiter === undefined) continue
        const now2 = Date.now()
        if (
          Math.max(
            now2,
            retryIsStillNext ? this.nextRetryAt : this.nextRequestAt,
            this.cooldownUntil,
            recheckedWaiter.notBefore
          ) > requestAt
        ) {
          continue
        }

        const waiter =
          this.retryWaiters.shift() ??
          this.interactiveWaiters.shift() ??
          this.defaultWaiters.shift()
        if (waiter === undefined) continue
        this.nextRequestAt = Math.max(
          this.nextRequestAt,
          requestAt + API_REQUEST_MIN_INTERVAL_MS + jitter()
        )
        this.nextRetryAt = Math.max(this.nextRetryAt, requestAt + API_REQUEST_MIN_INTERVAL_MS)
        waiter.resolve()
      }
    } catch (error) {
      for (const waiter of [
        ...this.retryWaiters,
        ...this.interactiveWaiters,
        ...this.defaultWaiters
      ]) {
        waiter.reject(error)
      }
      this.retryWaiters.length = 0
      this.interactiveWaiters.length = 0
      this.defaultWaiters.length = 0
    } finally {
      this.wakeDispatcher = null
      this.dispatchingRequests = false
    }
  }

  private rateLimitDelay(response: Response, retryCount: number): number {
    const headerDelay = retryAfterDelayMs(response.headers.get('Retry-After'), Date.now())
    const fallbackDelay = Math.min(BASE_RETRY_DELAY_MS * 2 ** retryCount, MAX_RETRY_DELAY_MS)
    return (headerDelay ?? fallbackDelay) + jitter()
  }

  private applyCooldown(delay: number, reserveRetrySlot: boolean): number {
    const retryAt = Date.now() + delay
    this.cooldownUntil = Math.max(this.cooldownUntil, retryAt)
    this.nextRequestAt = Math.max(
      this.nextRequestAt,
      retryAt + (reserveRetrySlot ? API_REQUEST_MIN_INTERVAL_MS + jitter() : 0)
    )
    return retryAt
  }

  abstract getAuthStatus(): Promise<AuthStatus>
  abstract login(credentials: Credentials): Promise<LoginResult>
  /** Complete a `needs2fa` login (VRX-159). Platforms without 2-leg 2FA reject it. */
  abstract verify2fa(code: string): Promise<LoginResult>
  abstract clearSession(): void
  abstract getFriends(): Promise<Friend[]>
  abstract getInstanceDetails(instanceId: string): Promise<InstanceInfo>
  abstract buildJoinUrl(instance: InstanceInfo, mode: JoinMode): string | null
  abstract selfInvite(instanceId: string): Promise<void>
  abstract subscribe(handler: (event: AdapterEvent) => void): Unsubscribe
}

function retryAfterDelayMs(header: string | null, now: number): number | null {
  if (header === null) return null

  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000
  if (!/[a-z,]/i.test(trimmed)) return null

  const retryAt = Date.parse(trimmed)
  if (Number.isFinite(retryAt) && retryAt >= now) return retryAt - now

  return null
}
