import type { OwnProfile } from '@shared/ownProfile'
import { record } from '../avatarItemFields'
import { ownText } from '../ownProfileFields'

/**
 * `GET /users/{me}`: the bio and pronouns, only for the signed-in account.
 * ChilloutVR has no status to set. Null when the reply is for someone else or
 * a field has an unexpected type.
 */
export function parseCvrOwnProfile(value: unknown, accountId: string): OwnProfile | null {
  const raw = record(value)
  if (!raw || typeof raw.id !== 'string' || raw.id.toLowerCase() !== accountId.toLowerCase()) {
    return null
  }
  const bio = ownText(raw.profileBio)
  const pronouns = ownText(raw.profilePronouns)
  if (bio === undefined || pronouns === undefined) return null
  return { platform: 'chilloutvr', bio, pronouns, status: null, statusText: null }
}
