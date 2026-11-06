/**
 * The signed-in user's own profile: the bio and pronouns on both platforms,
 * and VRChat's status and status text (ChilloutVR has no status to set). It
 * is read when the user opens the editor and written only when they press
 * Save; nothing here runs on its own.
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */
import type { Platform, UserStatus } from './types'

/** Longest bio either platform's own editor accepts (VRChat, CVRX: 512). */
export const OWN_BIO_MAX_LENGTH = 512
/** Longest pronouns either platform's own editor accepts (32). */
export const OWN_PRONOUNS_MAX_LENGTH = 32
/** Longest VRChat status text (32). */
export const OWN_STATUS_TEXT_MAX_LENGTH = 32
/** A Save, failed or not, waits this long before the next one may go out. */
export const OWN_PROFILE_SAVE_COOLDOWN_MS = 5_000
/** Opening the editor again re-reads only an answer at least this old. */
export const OWN_PROFILE_REREAD_MS = 30_000

/** The VRChat statuses a user can pick, least to most private. */
export const OWN_STATUSES = ['join-me', 'online', 'ask-me', 'dnd'] as const
export type OwnStatus = (typeof OWN_STATUSES)[number] & NonNullable<UserStatus>

export interface OwnProfile {
  platform: Platform
  /** Empty when the user has none. */
  bio: string
  pronouns: string
  /** VRChat only; null on ChilloutVR, or when VRChat's reply did not say. */
  status: OwnStatus | null
  /** VRChat only; null on ChilloutVR. Empty when the user has none. */
  statusText: string | null
}

/** Only the fields the user changed. Status fields are VRChat only. */
export interface OwnProfileChanges {
  bio?: string
  pronouns?: string
  status?: OwnStatus
  statusText?: string
}

export type OwnProfileFailure = 'not-authenticated' | 'rate-limited' | 'unavailable'

export type OwnProfileResult =
  { ok: true; profile: OwnProfile } | { ok: false; reason: OwnProfileFailure }

export type SaveOwnProfileResult =
  | { ok: true; profile: OwnProfile }
  | {
      ok: false
      /** `cooldown`: a Save went out under 5 s ago or is still running.
       *  `invalid`: too long, or a status change on ChilloutVR. */
      reason: OwnProfileFailure | 'cooldown' | 'invalid'
    }

export function isOwnStatus(value: unknown): value is OwnStatus {
  return typeof value === 'string' && (OWN_STATUSES as readonly string[]).includes(value)
}

/**
 * Text as it is sent: line endings made `\n`, other control characters
 * removed, and the ends trimmed. Bios keep their line breaks; one-line fields
 * turn them into spaces. Null when it is still longer than `max`.
 */
export function normalizeOwnProfileText(
  value: unknown,
  max: number,
  multiline: boolean
): string | null {
  if (typeof value !== 'string') return null
  let text = value.replace(/\r\n?/g, '\n')
  if (!multiline) text = text.replace(/\n+/g, ' ')
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim()
  return text.length > max ? null : text
}
