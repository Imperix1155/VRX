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
  constructor(message = 'ChilloutVR authentication required') {
    super(message)
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
