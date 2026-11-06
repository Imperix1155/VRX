/**
 * Friend actions: answer a friend request from the Inbox, or send one from a
 * profile. These are the only friend writes VRX makes, one press each, on the
 * signed-in user's own account.
 *
 * The renderer names an inbox row by its main-issued ID, or a person a search
 * listed by user ID; main decides what to send. Nothing here runs on its own.
 *
 * ⚠️ Pure types and values, bundled into the sandboxed renderer.
 */
import type { Platform } from './types'

export const FRIEND_REQUEST_ANSWERS = ['accept', 'decline'] as const
export type FriendRequestAnswer = (typeof FRIEND_REQUEST_ANSWERS)[number]

/**
 * Least time between two friend actions on one platform. Presses that come
 * sooner wait their turn in main, so a quick run of Accept presses still goes
 * out one at a time, spaced like a person would.
 */
export const FRIEND_ACTION_SPACING_MS = 2_000
/** Presses that may wait their turn per platform; more are refused as `busy`. */
export const FRIEND_ACTION_MAX_WAITING = 5

export type FriendActionFailure =
  | 'not-authenticated'
  | 'rate-limited'
  | 'unavailable'
  /** Too many presses waiting on this platform. */
  | 'busy'
  /** The platform answered no (the request was already answered, or it refused). */
  | 'refused'
  /** Answer: main has no such friend request row (already answered or gone). */
  | 'unknown-request'
  /** Add: not someone a search listed this session, or the signed-in user. */
  | 'unknown-person'
  /** Add: already on the friends list. */
  | 'already-friends'

export type FriendActionResult = { ok: true } | { ok: false; reason: FriendActionFailure }

export interface AnswerFriendRequest {
  platform: Platform
  /** The inbox row's main-issued ID (`friend-request:<record>`). */
  id: string
  answer: FriendRequestAnswer
}

export interface SendFriendRequest {
  platform: Platform
  userId: string
}
