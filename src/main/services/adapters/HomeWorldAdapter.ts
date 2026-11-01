import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/**
 * A narrow, main-only write capability: make one world the signed-in
 * account's home. It does not extend IPlatformAdapter. Every call follows a
 * user's press and waits in the platform's shared admission line. The
 * service owns the lease and passes it in so a write never crosses an account
 * boundary.
 */
export interface HomeWorldAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureHomeWorldLease(): RequestLease
  /** Send the one write. The service checks the world came from main first. */
  setHomeWorld(worldId: string, lease: RequestLease): Promise<void>
}

/** The world ID failed the shape check, so no request was sent. */
export class HomeWorldIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HomeWorldIdError'
  }
}
