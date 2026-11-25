import type { OwnProfile, OwnProfileChanges, OwnStatus } from '@shared/ownProfile'
import { record } from '../avatarItemFields'
import { ownText } from '../ownProfileFields'

/** VRChat's status words. "active" is the green Online status, "busy" is Do Not Disturb. */
const FROM_VRC_STATUS: Readonly<Record<string, OwnStatus>> = {
  'join me': 'join-me',
  active: 'online',
  'ask me': 'ask-me',
  busy: 'dnd'
}

const TO_VRC_STATUS: Readonly<Record<OwnStatus, string>> = {
  'join-me': 'join me',
  online: 'active',
  'ask-me': 'ask me',
  dnd: 'busy'
}

/** VRChat's status word, or null when it is missing or not one VRX knows. */
export function vrcOwnStatus(value: unknown): OwnStatus | null {
  if (typeof value !== 'string') return null
  const key = value.toLowerCase()
  return Object.hasOwn(FROM_VRC_STATUS, key) ? (FROM_VRC_STATUS[key] ?? null) : null
}

/** A known status on `user-update`, or `undefined` when the word is missing or unknown. */
export function vrcStatusFromUserUpdate(content: unknown): OwnStatus | undefined {
  if (content === null || typeof content !== 'object') return undefined
  const user = (content as { user?: unknown }).user
  if (user === null || typeof user !== 'object') return undefined
  return vrcOwnStatus((user as { status?: unknown }).status) ?? undefined
}

/**
 * `GET /profile/{me}?asSelf=true`: the four fields the editor shows, only for
 * the signed-in account. VRChat's 2026 profile update moved the bio off
 * `/users/{me}` onto the profile, so a reply with no `bio` at all is not read
 * as an empty bio the user might then save over. Null when the reply is for
 * someone else, has no bio field, or a field has an unexpected type.
 */
export function parseVrcOwnProfile(value: unknown, accountId: string): OwnProfile | null {
  const raw = record(value)
  if (!raw || raw.id !== accountId || !Object.hasOwn(raw, 'bio')) return null
  const bio = ownText(raw.bio)
  const pronouns = ownText(raw.pronouns)
  const statusText = ownText(raw.statusDescription)
  if (bio === undefined || pronouns === undefined || statusText === undefined) return null
  return { platform: 'vrchat', bio, pronouns, status: vrcOwnStatus(raw.status), statusText }
}

/**
 * The `PUT /users/{me}` body: the changed pronouns, status and status text,
 * in VRChat's words. Null when none of them changed.
 */
export function vrcOwnUserBody(changes: OwnProfileChanges): Record<string, string> | null {
  const body: Record<string, string> = {}
  if (changes.pronouns !== undefined) body.pronouns = changes.pronouns
  if (changes.status !== undefined) body.status = TO_VRC_STATUS[changes.status]
  if (changes.statusText !== undefined) body.statusDescription = changes.statusText
  return Object.keys(body).length > 0 ? body : null
}

/** The `PUT /profile/{me}` body: the changed bio. Null when it did not change. */
export function vrcOwnProfileBody(changes: OwnProfileChanges): Record<string, string> | null {
  return changes.bio !== undefined ? { bio: changes.bio } : null
}
