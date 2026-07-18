export class AuthError extends Error {
  constructor(
    message = 'Authentication required',
    public readonly status?: number
  ) {
    super(message)
    this.name = 'AuthError'
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
