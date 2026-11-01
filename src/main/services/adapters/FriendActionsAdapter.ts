import type { FriendRequestAnswer } from '@shared/friendActions'
import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/** The inbox record a friend request answer names. */
export interface FriendRequestRecord {
  /** The platform's own record ID: VRChat's notification ID; ChilloutVR's sender ID. */
  sourceId: string
  senderId: string
}

/**
 * A narrow, main-only write capability for friend requests: answer one that
 * arrived, or send one. It does not extend IPlatformAdapter, and the read-only
 * CommunityAdapter stays read-only. Every call follows one user press and is
 * never sent twice on its own. The service owns the lease and passes it to
 * each call so a write never lands on a different account.
 */
export interface FriendActionsAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureFriendActionLease(): RequestLease
  answerFriendRequest(
    record: FriendRequestRecord,
    answer: FriendRequestAnswer,
    lease: RequestLease
  ): Promise<void>
  /** The service checks first that a search listed this person. */
  sendFriendRequest(userId: string, lease: RequestLease): Promise<void>
}

/** The platform answered the write with a refusal (already answered, not allowed). */
export class FriendActionRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FriendActionRefusedError'
  }
}

/** The write could not leave VRX (ChilloutVR: the live socket is not connected). */
export class FriendActionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FriendActionUnavailableError'
  }
}
