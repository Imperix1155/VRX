/**
 * Avatar library: the avatars a signed-in user uploaded, the one they wear now,
 * and a user-clicked switch. "Avatar" here is the 3D model a person wears in
 * game, not a friend's round profile picture (`get-avatar` / `AvatarCache`).
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */
import type { Platform } from './types'

/** Most own avatars VRX lists per platform. Pagination stops here. */
export const AVATAR_LIBRARY_MAX_ITEMS = 500
/** Longest avatar name or description kept from a platform reply. */
export const AVATAR_TEXT_MAX_LENGTH = 2_048
/** Longest image URL kept; matches the `get-avatar` URL cap. */
export const AVATAR_IMAGE_URL_MAX_LENGTH = 2_048
/** Spacing between two switches on one platform (a human-paced action). */
export const AVATAR_SWITCH_COOLDOWN_MS = 5_000

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const VRC_AVATAR_ID = new RegExp(`^avtr_${GUID}$`, 'i')
const CVR_AVATAR_ID = new RegExp(`^${GUID}$`, 'i')

/** Shape check only. Main still accepts a switch only for an avatar it listed. */
export function isAvatarId(platform: Platform, value: unknown): value is string {
  if (typeof value !== 'string') return false
  return platform === 'vrchat' ? VRC_AVATAR_ID.test(value) : CVR_AVATAR_ID.test(value)
}

/** `null` when the platform did not say. */
export type AvatarVisibility = 'public' | 'private' | null

export interface AvatarItem {
  platform: Platform
  avatarId: string
  name: string
  description: string | null
  /** An image URL for `get-avatar`; main's image proxy allowlists its host. */
  imageUrl: string | null
  authorName: string | null
  visibility: AvatarVisibility
  /** ISO 8601 strings, or null when the platform did not send a readable date. */
  createdAt: string | null
  updatedAt: string | null
}

export type AvatarLibraryFailure = 'not-authenticated' | 'rate-limited' | 'unavailable'

export type AvatarLibraryResult =
  | {
      ok: true
      platform: Platform
      /** Uploaded by the signed-in user, newest change first. */
      avatars: AvatarItem[]
      /** False when pagination stopped at the cap or skipped unreadable records. */
      complete: boolean
      /** What the user wears now, or null when the platform did not say. */
      current: AvatarItem | null
    }
  | { ok: false; reason: AvatarLibraryFailure }

/**
 * Only the worn avatar, for the Dashboard: one platform request instead of
 * the whole uploads list. It never makes the avatar a switch target.
 */
export type CurrentAvatarResult =
  | { ok: true; platform: Platform; current: AvatarItem | null }
  | { ok: false; reason: AvatarLibraryFailure }

export type AvatarDetailsResult =
  { ok: true; avatar: AvatarItem } | { ok: false; reason: AvatarLibraryFailure | 'unknown-avatar' }

export type AvatarSwitchResult =
  | { ok: true }
  | {
      ok: false
      reason: 'not-authenticated' | 'unknown-avatar' | 'cooldown' | 'rate-limited' | 'switch-failed'
    }
