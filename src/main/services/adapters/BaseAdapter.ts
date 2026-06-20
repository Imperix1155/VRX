import { z } from 'zod'
import { API_TIMEOUT_MS } from '@shared/constants'
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

const MIN_INTERVAL_MS = 1_000
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_429_RETRIES = 3
const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_RESET_MS = 60_000

function jitter(): number {
  return Math.floor(Math.random() * 100)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Abstract base class for platform adapters (VRX-17).
 *
 * Provides `protected request<T>()` with: rate limiting (1 req/sec + jitter),
 * AbortSignal.timeout, redirect:'error', 429 exponential backoff (honors
 * Retry-After), Zod validation, and a circuit breaker (opens after 3
 * consecutive non-429 failures; resets on success or after CIRCUIT_RESET_MS).
 *
 * Pass a custom `sleepFn` in tests to skip real timers.
 */
export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform

  private readonly sleep: (ms: number) => Promise<void>
  private nextRequestAt = 0
  private cooldownUntil = 0
  private consecutiveFailures = 0
  private lastFailureAt = 0

  protected constructor(sleepFn: (ms: number) => Promise<void> = defaultSleep) {
    this.sleep = sleepFn
  }

  /**
   * Low-level request: rate limiting (1 req/sec + jitter), AbortSignal.timeout,
   * redirect:'error', 429 backoff/retry, and the circuit breaker — returning the
   * raw `Response` WITHOUT interpreting its status or body. Non-429 statuses
   * (200/401/500/…) come back as-is for the caller to interpret; only a thrown
   * fetch (network failure) records a circuit failure here.
   *
   * Auth flows use this directly so a 401 is a clean "wrong password" result —
   * NOT an `AuthError` plus a circuit-breaker lockout after 3 wrong attempts.
   */
  protected async rawRequest(url: string, options: RequestInit = {}): Promise<Response> {
    if (
      this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - this.lastFailureAt < CIRCUIT_RESET_MS
    ) {
      throw new NetworkError('Circuit open: too many consecutive failures')
    }
    return this.attemptRaw(url, options, 0, null)
  }

  private async attemptRaw(
    url: string,
    options: RequestInit,
    retryCount: number,
    reservedRetryAt: number | null
  ): Promise<Response> {
    if (reservedRetryAt === null) {
      await this.waitForRequestSlot()
    }

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
      this.recordFailure()
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
      await this.sleep(Math.max(0, retryAt - Date.now()))
      return this.attemptRaw(url, options, retryCount + 1, retryAt)
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
    options: RequestInit = {}
  ): Promise<T> {
    const response = await this.rawRequest(url, options)

    if (response.status === 401 || response.status === 403) {
      this.recordFailure()
      throw new AuthError()
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

  private async waitForRequestSlot(): Promise<void> {
    while (true) {
      const now = Date.now()
      const requestAt = Math.max(now, this.nextRequestAt, this.cooldownUntil)
      this.nextRequestAt = requestAt + MIN_INTERVAL_MS + jitter()

      if (requestAt > now) {
        await this.sleep(requestAt - now)
      }

      if (Date.now() >= this.cooldownUntil) return
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
      retryAt + (reserveRetrySlot ? MIN_INTERVAL_MS + jitter() : 0)
    )
    return retryAt
  }

  abstract getAuthStatus(): Promise<AuthStatus>
  abstract login(credentials: Credentials): Promise<LoginResult>
  abstract importSession(): Promise<boolean>
  abstract getFriends(): Promise<Friend[]>
  abstract getInstanceDetails(instanceId: string): Promise<InstanceInfo>
  abstract joinInstance(instanceId: string, mode: JoinMode): Promise<void>
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
