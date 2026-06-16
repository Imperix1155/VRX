import { z } from 'zod'
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
const API_TIMEOUT_MS = 10_000
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
  private lastRequestAt = 0
  private consecutiveFailures = 0
  private lastFailureAt = 0

  protected constructor(sleepFn: (ms: number) => Promise<void> = defaultSleep) {
    this.sleep = sleepFn
  }

  protected async request<T>(
    url: string,
    schema: z.ZodType<T>,
    options: RequestInit = {}
  ): Promise<T> {
    if (
      this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - this.lastFailureAt < CIRCUIT_RESET_MS
    ) {
      throw new NetworkError('Circuit open: too many consecutive failures')
    }
    return this.attempt(url, schema, options, 0)
  }

  private async attempt<T>(
    url: string,
    schema: z.ZodType<T>,
    options: RequestInit,
    retryCount: number
  ): Promise<T> {
    // Rate limit: enforce at least MIN_INTERVAL_MS between outgoing requests.
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < MIN_INTERVAL_MS) {
      await this.sleep(MIN_INTERVAL_MS - elapsed + jitter())
    }
    this.lastRequestAt = Date.now()

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
      if (retryCount >= MAX_429_RETRIES) {
        throw new RateLimitError(MAX_RETRY_DELAY_MS)
      }
      const retryAfterHeader = response.headers.get('Retry-After')
      const parsedRetryAfter = retryAfterHeader !== null ? parseInt(retryAfterHeader, 10) : NaN
      const delay = !isNaN(parsedRetryAfter)
        ? parsedRetryAfter * 1_000 + jitter()
        : Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS) + jitter()
      await this.sleep(delay)
      return this.attempt(url, schema, options, retryCount + 1)
    }

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

  abstract getAuthStatus(): Promise<AuthStatus>
  abstract login(credentials: Credentials): Promise<LoginResult>
  abstract importSession(): Promise<boolean>
  abstract getFriends(): Promise<Friend[]>
  abstract getInstanceDetails(instanceId: string): Promise<InstanceInfo>
  abstract joinInstance(instanceId: string, mode: JoinMode): Promise<void>
  abstract selfInvite(instanceId: string): Promise<void>
  abstract subscribe(handler: (event: AdapterEvent) => void): Unsubscribe
}
