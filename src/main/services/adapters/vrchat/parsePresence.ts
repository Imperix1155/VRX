/**
 * VRChat presence parser (VRX-44).
 *
 * Derives the TWO independent presence axes from raw VRChat API data:
 *   - state  (PresenceState) → the avatar dot. Derived from the current-user
 *             bucket arrays returned by /auth/user, NOT from a friend field.
 *   - status (UserStatus)   → the labeled pill. Mapped from the friend's own
 *             `status` string field.
 *
 * DESIGN.md §5: these axes are independent — never conflate them.
 * CLAUDE.md: unknown API enum values degrade gracefully, never crash.
 */

import type { PresenceState, UserStatus } from '@shared/types'

// ─── Raw API input shapes (local — not the normalized Friend model) ────────────

/** Minimal slice of the raw VRChat friend object consumed by this parser. */
export interface VrcRawFriend {
  id: string
  /** User-chosen status string from the VRChat API. */
  status?: string | null
  /** Custom status text, ≤32 chars. */
  statusDescription?: string | null
}

/**
 * Bucket arrays from the current user's /auth/user response.
 * VRChat semantics:
 *   onlineFriends  → friends in a world    → PresenceState 'in-game'
 *   activeFriends  → friends in the app    → PresenceState 'active'
 *   offlineFriends → offline friends       → PresenceState 'offline'
 */
export interface VrcCurrentUserBuckets {
  onlineFriends: string[]
  activeFriends: string[]
  offlineFriends: string[]
}

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface VrcParsedPresence {
  state: PresenceState
  status: UserStatus
  statusDescription: string | null
}

// ─── Status string → UserStatus mapping ──────────────────────────────────────

const STATUS_MAP: Record<string, UserStatus> = {
  'join me': 'join-me',
  active: 'online',
  'ask me': 'ask-me',
  busy: 'dnd',
  offline: null
}

function mapStatus(raw: string | null | undefined): UserStatus {
  if (raw == null) return null
  const key = raw.toLowerCase()
  if (key in STATUS_MAP) return STATUS_MAP[key]
  // Unknown strings degrade to 'online' (generic green pill — never crash per CLAUDE.md §API etiquette).
  return 'online'
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw VRChat friend's presence into the normalized two-axis shape.
 *
 * @param friend  - Raw VRChat friend object (needs only `id`, `status`, `statusDescription`).
 * @param buckets - Bucket arrays from the current user's /auth/user response.
 */
export function parsePresence(
  friend: VrcRawFriend,
  buckets: VrcCurrentUserBuckets
): VrcParsedPresence {
  // STATE: derived from bucket membership, not a friend field.
  let state: PresenceState
  if (buckets.onlineFriends.includes(friend.id)) {
    state = 'in-game'
  } else if (buckets.activeFriends.includes(friend.id)) {
    state = 'active'
  } else {
    state = 'offline'
  }

  // STATUS: mapped from the friend's own status string.
  const status = mapStatus(friend.status)

  // statusDescription: pass through; coerce undefined to null.
  const statusDescription = friend.statusDescription ?? null

  return { state, status, statusDescription }
}
