import type { AvatarItem } from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

export interface OwnAvatarsPage {
  avatars: AvatarItem[]
  /** False when pagination stopped at the cap or unreadable records were skipped. */
  complete: boolean
}

/**
 * A narrow, main-only capability for the user's own avatars; it does not
 * extend IPlatformAdapter. Every call is user-initiated and goes through the
 * platform's shared admission line. The service owns the lease and passes it
 * to each call so a reply never crosses an account boundary.
 */
export interface AvatarLibraryAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureAvatarLease(): RequestLease
  getOwnAvatars(lease: RequestLease): Promise<OwnAvatarsPage>
  getCurrentAvatar(lease: RequestLease): Promise<AvatarItem | null>
  /** One avatar's details, or null when the platform no longer has it. */
  getAvatarDetails(avatarId: string, lease: RequestLease): Promise<AvatarItem | null>
  /** Put the avatar on the signed-in account. The service checks the ID first. */
  switchAvatar(avatarId: string, lease: RequestLease): Promise<void>
}

/** The authenticated reply was structurally unusable. */
export class AvatarDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvatarDataError'
  }
}
