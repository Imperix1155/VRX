/**
 * Unfriend, block and unblock from a person's full profile. Each one is a
 * single platform write the user confirmed for one person; nothing here runs
 * on a timer, in bulk, or without a press.
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */
import type { Platform } from './types'

export const SOCIAL_ACTIONS = ['unfriend', 'block', 'unblock'] as const
export type SocialAction = (typeof SOCIAL_ACTIONS)[number]

/** Pause after any action on a platform before the next may go out. */
export const SOCIAL_ACTION_COOLDOWN_MS = 3_000
/** How long a read of whether someone is blocked is reused. */
export const RELATIONSHIP_CACHE_MS = 5 * 60_000

export interface Relationship {
  platform: Platform
  userId: string
  /** On the signed-in user's friends list as VRX knows it now. */
  isFriend: boolean
  /** Whether the signed-in user blocks them; null when the platform did not say. */
  blocked: boolean | null
}

export type SocialFailure =
  | 'not-authenticated'
  | 'rate-limited'
  | 'unavailable'
  /** Not a friend or someone a search listed this session. */
  | 'unknown-person'

export type RelationshipResult =
  { ok: true; relationship: Relationship } | { ok: false; reason: SocialFailure }

export type SocialActionResult =
  | { ok: true; relationship: Relationship }
  | {
      ok: false
      reason:
        | SocialFailure
        /** Unfriend for someone who is not a friend now. */
        | 'not-friend'
        /** Another action on that platform is still going, or just went. */
        | 'busy'
        /** ChilloutVR's live connection is down, so nothing was sent. */
        | 'not-connected'
    }
