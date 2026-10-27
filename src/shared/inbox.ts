/**
 * Inbox vocabulary: invites, invite requests and friend requests that the two
 * platform sockets already deliver to VRX.
 *
 * View-only by design. VRX shows what arrived while it was open; answering
 * stays in the game or on the platform's site, so nothing here can change the
 * user's account. Items live only in main's memory and never persist.
 *
 * ⚠️ Pure types and values, bundled into the sandboxed renderer.
 */
import type { Platform } from './types'

export const INBOX_KINDS = ['invite', 'invite-request', 'friend-request'] as const
/** `invite`: the sender invited the user. `invite-request`: the sender asked
 *  the user for an invite. `friend-request`: the sender wants to be friends. */
export type InboxKind = (typeof INBOX_KINDS)[number]

/** What a pipeline read from one wire record. Bounded and validated there. */
export interface InboxEntry {
  /** The platform's own record ID, used to dedupe and to honor removals. */
  sourceId: string
  kind: InboxKind
  /** Sender's platform user ID, normalized exactly like roster IDs. */
  senderId: string
  senderName: string | null
  /** Invites only: the world named in the invite. */
  worldName: string | null
}

/**
 * Inbox changes a pipeline publishes. `remove` names platform record IDs
 * (VRChat hides or answers a notification elsewhere); `clear` drops every
 * item for the platform (VRChat's clear-all).
 */
export type InboxChange =
  { op: 'add'; entries: InboxEntry[] } | { op: 'remove'; sourceIds: string[] } | { op: 'clear' }

/** One row the renderer shows. */
export interface InboxItem {
  /** Main-issued key, unique per platform. Opaque to the renderer. */
  id: string
  platform: Platform
  kind: InboxKind
  senderId: string
  senderName: string | null
  worldName: string | null
  /** Main's wall-clock time (ms) when VRX first received it. */
  receivedAt: number
}

/** Newest first across both platforms. */
export interface InboxSnapshot {
  items: InboxItem[]
}

/** Rows kept per platform; the oldest drops first. */
export const MAX_INBOX_ITEMS_PER_PLATFORM = 50
/** Dismissed record IDs remembered per platform, so a socket replay stays hidden. */
export const MAX_INBOX_DISMISSED_PER_PLATFORM = 200
/** Upper bounds for wire strings. Longer values are cut (names) or rejected (IDs). */
export const INBOX_ID_MAX_LENGTH = 128
export const INBOX_NAME_MAX_LENGTH = 64
export const INBOX_WORLD_NAME_MAX_LENGTH = 128
/** Records read from one wire frame; the rest of an oversized frame is ignored. */
export const MAX_INBOX_ENTRIES_PER_FRAME = 50

const INBOX_ID_RE = /^[A-Za-z0-9_:.-]+$/

/** A platform record or user ID safe to keep and compare. */
export function isInboxId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= INBOX_ID_MAX_LENGTH &&
    INBOX_ID_RE.test(value)
  )
}

/** Trim a display string to a bound; empty or non-string becomes null. */
export function boundedInboxText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length <= max) return trimmed
  // Cut by code point so a name never ends in half an emoji.
  return Array.from(trimmed).slice(0, max).join('')
}
