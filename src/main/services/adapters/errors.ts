export class AuthError extends Error {
  constructor(
    message = 'Authentication required',
    public readonly status?: number
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** An authenticated request tried to use a session before durable persistence settled. */
export class AuthSessionPendingError extends AuthError {
  constructor() {
    super('Authentication session is still being persisted')
    this.name = 'AuthSessionPendingError'
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Rate limited; retry after ${retryAfterMs}ms`)
    this.name = 'RateLimitError'
  }
}

export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'NetworkError'
  }
}

/**
 * Refused locally: three requests in a row failed, so this platform's requests
 * pause for a minute. Nothing was sent. The friends read reports it as a
 * slow-down, so the window waits instead of retrying into the pause.
 */
export class CircuitOpenError extends NetworkError {
  constructor() {
    super('Circuit open: too many consecutive failures')
  }
}

/** The platform answered with an HTTP error status that has no meaning of its own here. */
export class HttpStatusError extends NetworkError {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpStatusError'
  }
}

/**
 * Whether the platform answered 404 Not Found, directly or wrapped in a
 * platform's own network error.
 */
export function isNotFoundStatus(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status === 404
  return error instanceof NetworkError && error.cause instanceof HttpStatusError
    ? error.cause.status === 404
    : false
}

/** Obsolete work is stopped locally; it is neither a network nor an auth failure. */
export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled')
    this.name = 'RequestCancelledError'
  }
}

/** Admission overflow must fail once, without replaying an action automatically. */
export class RequestQueueFullError extends Error {
  constructor() {
    super('Request queue is full')
    this.name = 'RequestQueueFullError'
  }
}

export class CVRAuthError extends AuthError {
  constructor(message = 'ChilloutVR authentication required', status?: number) {
    super(message, status)
    this.name = 'CVRAuthError'
  }
}

export class CVRRateLimitError extends RateLimitError {
  constructor(retryAfterMs: number) {
    super(retryAfterMs)
    this.name = 'CVRRateLimitError'
  }
}

export class CVRNetworkError extends NetworkError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'CVRNetworkError'
  }
}

/**
 * The typed code a failed sign-in request reports: `rate_limited` when the
 * platform asked to slow down (or VRX is still waiting out such a request),
 * `network_error` for everything else that kept an answer from arriving.
 */
export function signInFailure(error: unknown): 'rate_limited' | 'network_error' {
  return error instanceof RateLimitError ? 'rate_limited' : 'network_error'
}
