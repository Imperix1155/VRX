import { isAvatarId, type AvatarItem } from '@shared/avatarLibrary'
import { imageUrl, isoDate, record, text } from '../avatarItemFields'

/** ChilloutVR tags the signed-in user's own uploads with this category. */
const OWN_AVATAR_CATEGORY = 'avtrmine'

/**
 * ChilloutVR `GET /avatars` lists every avatar the user can wear: their own,
 * ones shared with them, and favorites. VRX keeps only their own uploads
 * (author GUID equals the signed-in user, or the `avtrmine` category), so the
 * list means the same thing as VRChat's. The list reply carries no author
 * name, visibility, or dates; those come from `GET /avatars/{id}`.
 */
export function parseCvrOwnAvatars(
  value: unknown,
  ownUserId: string,
  ownName: string | null
): { avatars: AvatarItem[]; skipped: number } | null {
  if (!Array.isArray(value)) return null
  const avatars: AvatarItem[] = []
  let skipped = 0
  const owner = ownUserId.toLowerCase()
  for (const entry of value) {
    const raw = record(entry)
    if (!raw) {
      skipped++
      continue
    }
    const categories = Array.isArray(raw.categories) ? raw.categories : []
    const author = typeof raw.authorGuid === 'string' ? raw.authorGuid.toLowerCase() : null
    const own = author === owner || (author === null && categories.includes(OWN_AVATAR_CATEGORY))
    if (!own) continue
    const avatar = listItem(raw, ownName)
    if (avatar) avatars.push(avatar)
    else skipped++
  }
  return { avatars, skipped }
}

function listItem(raw: Record<string, unknown>, ownName: string | null): AvatarItem | null {
  if (!isAvatarId('chilloutvr', raw.id)) return null
  const name = text(raw.name)
  if (name === null) return null
  return {
    platform: 'chilloutvr',
    avatarId: raw.id.toLowerCase(),
    name,
    description: text(raw.description),
    imageUrl: imageUrl(raw.imageUrl),
    authorName: ownName,
    visibility: null,
    createdAt: null,
    updatedAt: null
  }
}

/** `GET /avatars/{id}`: the full record, with author, published state and dates. */
export function parseCvrAvatarDetails(value: unknown): AvatarItem | null {
  const raw = record(value)
  if (!raw || !isAvatarId('chilloutvr', raw.id)) return null
  const name = text(raw.name)
  if (name === null) return null
  const author = record(raw.author)
  return {
    platform: 'chilloutvr',
    avatarId: raw.id.toLowerCase(),
    name,
    description: text(raw.description),
    imageUrl: imageUrl(raw.imageUrl),
    authorName: author ? text(author.name) : null,
    visibility: raw.isPublished === true ? 'public' : raw.isPublished === false ? 'private' : null,
    createdAt: isoDate(raw.uploadedAt),
    updatedAt: isoDate(raw.updatedAt)
  }
}

/**
 * `GET /users/{id}`: the `avatar` the user wears now (id, name, picture only).
 * It may be someone else's public avatar, so no author is assumed.
 */
export function parseCvrCurrentAvatar(value: unknown): AvatarItem | null {
  const user = record(value)
  const avatar = user ? record(user.avatar) : null
  return avatar ? listItem(avatar, null) : null
}
