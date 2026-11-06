import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/**
 * Main-only access to the private note the signed-in user keeps on a friend
 * in their own VRChat or ChilloutVR account. Kept apart from the read-only
 * CommunityAdapter because it writes. Every call follows a user action (a
 * drawer opening, a saved edit, or a choice), waits in the platform's shared
 * admission line at interactive priority, and is never sent twice on its own.
 */
export interface AccountNoteAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureNoteLease(): RequestLease
  /**
   * The note on that person, `''` when there is none, or null when the reply
   * did not say (VRX then refuses to write, since it cannot tell what a write
   * would replace).
   */
  readAccountNote(userId: string, lease: RequestLease): Promise<string | null>
  /** Replace the note on that person. `''` clears it. */
  writeAccountNote(userId: string, note: string, lease: RequestLease): Promise<void>
}

/** Pull a note out of a `/users/{id}` reply for exactly that person. */
export function parseAccountNoteReply(
  value: unknown,
  userId: string,
  sameId: (left: string, right: string) => boolean
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !sameId(raw.id, userId)) return null
  if (!Object.hasOwn(raw, 'note')) return null
  if (raw.note === null) return ''
  return typeof raw.note === 'string' ? raw.note : null
}
