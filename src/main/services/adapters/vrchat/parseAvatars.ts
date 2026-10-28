import { isAvatarId, type AvatarItem, type AvatarVisibility } from '@shared/avatarLibrary'
import { imageUrl, isoDate, record, text } from '../avatarItemFields'

/**
 * VRChat avatar records (`GET /avatars?user=me`, `GET /avatars/{id}`,
 * `GET /users/{id}/avatar`). Only the fields the Avatars page shows are read;
 * a record without a valid `avtr_` ID or a name is skipped.
 */
export function parseVrcAvatar(value: unknown): AvatarItem | null {
  const raw = record(value)
  if (!raw || !isAvatarId('vrchat', raw.id)) return null
  const name = text(raw.name)
  if (name === null) return null
  return {
    platform: 'vrchat',
    avatarId: raw.id,
    name,
    description: text(raw.description),
    // The thumbnail is the small picture VRChat makes for lists; the full
    // image is the fallback.
    imageUrl: imageUrl(raw.thumbnailImageUrl) ?? imageUrl(raw.imageUrl),
    authorName: text(raw.authorName),
    visibility: parseVrcReleaseStatus(raw.releaseStatus),
    createdAt: isoDate(raw.created_at),
    updatedAt: isoDate(raw.updated_at)
  }
}

/** `public` and `private` are the two states a user picks; anything else is unknown. */
function parseVrcReleaseStatus(value: unknown): AvatarVisibility {
  if (value === 'public') return 'public'
  if (value === 'private') return 'private'
  return null
}

/** One page of a list reply. A non-array page is malformed, not empty. */
export function parseVrcAvatarPage(
  value: unknown
): { avatars: AvatarItem[]; skipped: number; received: number } | null {
  if (!Array.isArray(value)) return null
  const avatars: AvatarItem[] = []
  let skipped = 0
  for (const entry of value) {
    const avatar = parseVrcAvatar(entry)
    if (avatar) avatars.push(avatar)
    else skipped++
  }
  return { avatars, skipped, received: value.length }
}
