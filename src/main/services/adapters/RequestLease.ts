import { RequestCancelledError } from './errors'

/** Main-only ownership of an operation; never carries credentials across IPC. */
export interface RequestLease {
  readonly generation: number
  readonly signal: AbortSignal
  isCurrent(): boolean
}

/** An image captures this once; the cookie is read only after dispatch admission. */
export interface AvatarRequestLease extends RequestLease {
  getCookie(): string | null
}

export function assertRequestLease(lease: RequestLease | undefined): void {
  if (lease && (lease.signal.aborted || !lease.isCurrent())) throw new RequestCancelledError()
}
