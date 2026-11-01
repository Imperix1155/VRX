import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/**
 * A narrow, main-only capability for the profile's Unfriend, Block and
 * Unblock. Each write is one request (VRChat REST) or one socket message
 * (ChilloutVR) for one person, sent only after the user confirmed it; nothing
 * retries on its own. The service owns the lease and passes it to each call so
 * a write never crosses an account boundary. It does not extend
 * IPlatformAdapter.
 */
export interface SocialActionAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureSocialLease(): RequestLease
  /** Whether the signed-in user blocks them; null when the reply did not say. */
  getBlocked(userId: string, lease: RequestLease): Promise<boolean | null>
  unfriend(userId: string, lease: RequestLease): Promise<void>
  block(userId: string, lease: RequestLease): Promise<void>
  unblock(userId: string, lease: RequestLease): Promise<void>
}

/** The authenticated reply was structurally unusable, or the ID was. */
export class SocialDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocialDataError'
  }
}

/** ChilloutVR's live connection was closed, so the message was not sent. */
export class SocialNotSentError extends Error {
  constructor() {
    super('Live connection closed; nothing was sent')
    this.name = 'SocialNotSentError'
  }
}
