import { z } from 'zod'
import { API_TIMEOUT_MS } from '@shared/constants'
import type {
  AdapterEvent,
  AuthStatus,
  Credentials,
  InstanceInfo,
  JoinMode,
  LoginResult,
  Platform
} from '@shared/types'
import type { FriendRoster, IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'
import { AuthError, NetworkError, RateLimitError, RequestCancelledError } from './errors'
import { ApiAdmissionController } from './ApiAdmissionController'
import type { RequestPriority } from './ApiAdmissionController'
import { assertRequestLease, type RequestLease } from './RequestLease'
export type { RequestPriority } from './ApiAdmissionController'

const MAX_429_RETRIES = 3
const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_RESET_MS = 60_000

export interface AdapterRequestOptions {
  priority?: RequestPriority
  recordCircuitFailure?: boolean
  signal?: AbortSignal
  lease?: RequestLease
  retry?: 'bounded' | 'none'
  beforeDispatch?: () => void
}

export type RequestInitSource = RequestInit | (() => RequestInit)

/**
 * Abstract base class for platform adapters (VRX-17).
 *
 * Provides `protected request<T>()` with: a priority-aware dispatcher that
 * preserves the 1 req/sec + jitter wire ceiling, AbortSignal.timeout,
 * redirect:'error', 429 exponential backoff (honors Retry-After), Zod
 * validation, and a circuit breaker (opens after 3 consecutive non-429
 * failures; resets on success or after CIRCUIT_RESET_MS).
 *
 * Main injects one admission controller shared with every platform API path.
 */
export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform

  private consecutiveFailures = 0
  private lastFailureAt = 0

  protected constructor(protected readonly admission = new ApiAdmissionController()) {}

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
    options: RequestInitSource = {},
    requestOptions: AdapterRequestOptions = {}
  ): Promise<Response> {
    const {
      recordCircuitFailure = true,
      priority = 'default',
      retry = 'bounded',
      beforeDispatch
    } = requestOptions
    assertRequestLease(requestOptions.lease)
    const signalsForCaller = [
      requestOptions.signal,
      requestOptions.lease?.signal,
      typeof options === 'function' ? undefined : options.signal
    ].filter((value): value is AbortSignal => value != null)
    const signal = signalsForCaller.length ? AbortSignal.any(signalsForCaller) : undefined
    if (signal?.aborted) throw new RequestCancelledError()
    if (
      this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - this.lastFailureAt < CIRCUIT_RESET_MS
    ) {
      throw new NetworkError('Circuit open: too many consecutive failures')
    }
    let notBefore: number | undefined
    const rateLimitRevision = this.admission.rateLimitRevision
    for (let attempt = 0; ; attempt++) {
      do {
        await this.admission.acquire({
          priority,
          signal,
          notBefore,
          rejectOnCooldown: retry === 'none'
        })
        if (signal?.aborted) throw new RequestCancelledError()
        assertRequestLease(requestOptions.lease)
        if (retry === 'none' && rateLimitRevision !== this.admission.rateLimitRevision) {
          throw new RateLimitError(this.admission.cooldownRemainingMs)
        }
        beforeDispatch?.()
        // A response can extend cooldown between permit resolution and this
        // continuation. No captured headers may leave during that new wait.
      } while (this.admission.cooldownRemainingMs > 0)
      const init = typeof options === 'function' ? options() : options
      if (init.signal?.aborted) throw new RequestCancelledError()
      const signals = [AbortSignal.timeout(API_TIMEOUT_MS)]
      if (signal) signals.push(signal)
      if (init.signal) signals.push(init.signal)
      let response: Response
      try {
        response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any(signals)
        })
      } catch (error) {
        if (signal?.aborted || init.signal?.aborted) throw new RequestCancelledError()
        if (recordCircuitFailure) this.recordFailure()
        throw new NetworkError('Request failed', error)
      }
      if (response.status === 429) {
        notBefore = this.admission.rateLimited(response.headers.get('Retry-After'))
        await response.body?.cancel().catch(() => {})
        if (signal?.aborted) throw new RequestCancelledError()
        if (retry === 'none' || attempt >= MAX_429_RETRIES) {
          throw new RateLimitError(this.admission.cooldownRemainingMs)
        }
        continue
      }
      if (signal?.aborted) {
        await response.body?.cancel().catch(() => {})
        throw new RequestCancelledError()
      }
      assertRequestLease(requestOptions.lease)
      if (response.ok) this.admission.succeeded()
      return response
    }
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
    options: RequestInitSource = {},
    requestOptions: AdapterRequestOptions = {}
  ): Promise<T> {
    const response = await this.rawRequest(url, options, requestOptions)
    this.assertRequestCurrent(options, requestOptions)

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {})
      this.assertRequestCurrent(options, requestOptions)
      this.recordFailure()
      throw new AuthError(undefined, response.status)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      this.assertRequestCurrent(options, requestOptions)
      this.recordFailure()
      throw new NetworkError(`HTTP ${response.status}`)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      this.assertRequestCurrent(options, requestOptions)
      this.recordFailure()
      throw new NetworkError('Failed to parse response body')
    }

    this.assertRequestCurrent(options, requestOptions)
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

  private assertRequestCurrent(
    options: RequestInitSource,
    requestOptions: AdapterRequestOptions
  ): void {
    assertRequestLease(requestOptions.lease)
    if (
      requestOptions.signal?.aborted ||
      (typeof options !== 'function' && options.signal?.aborted)
    ) {
      throw new RequestCancelledError()
    }
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

  abstract getAuthStatus(): Promise<AuthStatus>
  abstract login(credentials: Credentials): Promise<LoginResult>
  /** Complete a `needs2fa` login (VRX-159). Platforms without 2-leg 2FA reject it. */
  abstract verify2fa(code: string): Promise<LoginResult>
  abstract clearSession(): void
  abstract getFriends(): Promise<FriendRoster>
  abstract getInstanceDetails(instanceId: string): Promise<InstanceInfo>
  abstract buildJoinUrl(instance: InstanceInfo, mode: JoinMode): string | null
  abstract selfInvite(instanceId: string): Promise<void>
  abstract subscribe(handler: (event: AdapterEvent) => void): Unsubscribe
}
