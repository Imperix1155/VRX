import type { OwnProfile, OwnProfileChanges } from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/**
 * A narrow, main-only capability for the signed-in user's own profile: read
 * it, and write the fields the user changed. It does not extend
 * IPlatformAdapter. Every call follows a user action (opening the editor or
 * pressing Save) and waits in the platform's shared admission line; a write is
 * never resent on its own. The service owns the lease and passes it to each
 * call so nothing crosses an account boundary.
 */
export interface OwnProfileAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureOwnProfileLease(): RequestLease
  getOwnProfile(lease: RequestLease): Promise<OwnProfile>
  /**
   * Send only `changes` (already checked by the service). Resolves with the
   * profile the platform answered, or null when its reply did not carry one.
   */
  saveOwnProfile(changes: OwnProfileChanges, lease: RequestLease): Promise<OwnProfile | null>
}

/** The authenticated reply was structurally unusable. */
export class OwnProfileDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OwnProfileDataError'
  }
}
