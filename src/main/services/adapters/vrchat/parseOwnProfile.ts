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

function ownStatus(value: unknown): OwnStatus | null {
  if (typeof value !== 'string') return null
  const key = value.toLowerCase()
  return Object.hasOwn(FROM_VRC_STATUS, key) ? (FROM_VRC_STATUS[key] ?? null) : null
}

/**
 * `GET /users/{me}` or the `PUT /users/{me}` reply: the four fields the editor
 * shows, only for the signed-in account. Null when the reply is for someone
 * else or a field has an unexpected type.
 */
export function parseVrcOwnProfile(value: unknown, accountId: string): OwnProfile | null {
  const raw = record(value)
  if (!raw || raw.id !== accountId) return null
  const bio = ownText(raw.bio)
  const pronouns = ownText(raw.pronouns)
  const statusText = ownText(raw.statusDescription)
  if (bio === undefined || pronouns === undefined || statusText === undefined) return null
  return { platform: 'vrchat', bio, pronouns, status: ownStatus(raw.status), statusText }
}

/** The `PUT /users/{me}` body: only the changed fields, in VRChat's words. */
export function vrcOwnProfileBody(changes: OwnProfileChanges): Record<string, string> {
  const body: Record<string, string> = {}
  if (changes.bio !== undefined) body.bio = changes.bio
  if (changes.pronouns !== undefined) body.pronouns = changes.pronouns
  if (changes.status !== undefined) body.status = TO_VRC_STATUS[changes.status]
  if (changes.statusText !== undefined) body.statusDescription = changes.statusText
  return body
}
