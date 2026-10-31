import {
  COMMUNITY_MAX_BADGES,
  COMMUNITY_PROFILE_MAX_ITEMS,
  isCommunityUserId,
  type CommunityGroup,
  type CommunityWorld,
  type PersonProfile,
  type PersonSummary,
  type ProfileBadge
} from '@shared/community'
import { imageUrl, record, text, type RecordValue } from '../avatarItemFields'
import type { CommunityList } from '../CommunityAdapter'
import { profileThumbnail } from './fetchFriends'
import { parseTrustRank } from './parseTrustRank'

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const WORLD_ID = new RegExp(`^wrld_${GUID}$`, 'i')
const GROUP_ID = new RegExp(`^grp_${GUID}$`, 'i')

function firstImage(...values: unknown[]): string | null {
  for (const value of values) {
    const url = imageUrl(value)
    if (url !== null) return url
  }
  return null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * A person from `GET /users?search=` or `GET /users/{id}`. The picture follows
 * the friends list: the user's own icon or profile picture before the avatar
 * thumbnail, which shows a gray robot for private avatars.
 */
export function parseVrcPerson(value: unknown): PersonSummary | null {
  const raw = record(value)
  if (!raw || !isCommunityUserId('vrchat', raw.id)) return null
  const displayName = text(raw.displayName)
  if (displayName === null) return null
  return {
    platform: 'vrchat',
    userId: raw.id,
    displayName,
    imageUrl: firstImage(
      typeof raw.iconUrl === 'string' ? profileThumbnail(raw.iconUrl) : null,
      raw.userIcon,
      raw.profilePicOverrideThumbnail,
      raw.currentAvatarThumbnailImageUrl
    ),
    isFriend: typeof raw.isFriend === 'boolean' ? raw.isFriend : null
  }
}

/** Showcased badges first, hidden ones never; at most COMMUNITY_MAX_BADGES. */
function parseBadges(value: unknown): ProfileBadge[] {
  if (!Array.isArray(value)) return []
  const shown: Array<{ badge: ProfileBadge; showcased: boolean }> = []
  for (const entry of value.slice(0, 64)) {
    const raw = record(entry)
    if (!raw || raw.hidden === true) continue
    const name = text(raw.badgeName)
    if (name === null) continue
    shown.push({
      badge: { name, imageUrl: imageUrl(raw.badgeImageUrl) },
      showcased: raw.showcased === true
    })
  }
  return shown
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => Number(b.showcased) - Number(a.showcased) || a.index - b.index)
    .slice(0, COMMUNITY_MAX_BADGES)
    .map(({ badge }) => badge)
}

/** `GET /users/{id}`: the profile fields VRX shows, nothing else. */
export function parseVrcProfile(value: unknown): PersonProfile | null {
  const person = parseVrcPerson(value)
  const raw = record(value)
  if (!person || !raw) return null
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
    : null
  const trust = tags === null ? null : parseTrustRank(tags)
  return {
    ...person,
    pronouns: text(raw.pronouns),
    bio: text(raw.bio),
    rank: trust === null ? null : { kind: 'vrchat-trust', value: trust },
    badges: parseBadges(raw.badges)
  }
}

/** A search reply. A non-array reply is malformed, not empty. */
export function parseVrcPeople(value: unknown, max: number): CommunityList<PersonSummary> | null {
  if (!Array.isArray(value)) return null
  const items: PersonSummary[] = []
  const seen = new Set<string>()
  let complete = true
  for (const entry of value) {
    const person = parseVrcPerson(entry)
    if (!person) {
      complete = false
      continue
    }
    if (seen.has(person.userId)) continue
    seen.add(person.userId)
    if (items.length >= max) {
      complete = false
      break
    }
    items.push(person)
  }
  return { items, complete }
}

/** `GET /worlds?userId=`: a person's public worlds, for display only. */
export function parseVrcProfileWorlds(value: unknown): CommunityList<CommunityWorld> | null {
  if (!Array.isArray(value)) return null
  const items: CommunityWorld[] = []
  const seen = new Set<string>()
  let complete = true
  for (const entry of value) {
    const raw = record(entry)
    const name = raw ? text(raw.name) : null
    if (!raw || typeof raw.id !== 'string' || !WORLD_ID.test(raw.id) || name === null) {
      complete = false
      continue
    }
    if (seen.has(raw.id)) continue
    seen.add(raw.id)
    if (items.length >= COMMUNITY_PROFILE_MAX_ITEMS) {
      complete = false
      break
    }
    items.push({
      platform: 'vrchat',
      worldId: raw.id,
      name,
      imageUrl: firstImage(raw.thumbnailImageUrl, raw.imageUrl)
    })
  }
  return { items, complete }
}

function groupCode(raw: RecordValue): string | null {
  const shortCode = text(raw.shortCode)
  if (shortCode === null) return null
  const discriminator = text(raw.discriminator)
  return discriminator === null ? shortCode : `${shortCode}.${discriminator}`
}

/**
 * One membership from `GET /users/{id}/groups`. There `id` is the membership
 * (`gmem_`) and `groupId` the group; a plain group record uses `id`.
 * `selfId` names the signed-in user for their own list, which gives the role.
 */
export function parseVrcGroup(value: unknown, selfId: string | null): CommunityGroup | null {
  const raw = record(value)
  if (!raw) return null
  const groupId =
    typeof raw.groupId === 'string' && GROUP_ID.test(raw.groupId)
      ? raw.groupId
      : typeof raw.id === 'string' && GROUP_ID.test(raw.id)
        ? raw.id
        : null
  const name = text(raw.name)
  if (groupId === null || name === null) return null
  return {
    platform: 'vrchat',
    groupId,
    name,
    code: groupCode(raw),
    description: text(raw.description),
    imageUrl: imageUrl(raw.iconUrl),
    bannerUrl: imageUrl(raw.bannerUrl),
    memberCount: count(raw.memberCount),
    role:
      selfId === null
        ? null
        : typeof raw.ownerId === 'string' && raw.ownerId === selfId
          ? 'owner'
          : 'member'
  }
}

export function parseVrcGroups(
  value: unknown,
  selfId: string | null,
  max: number
): CommunityList<CommunityGroup> | null {
  if (!Array.isArray(value)) return null
  const items: CommunityGroup[] = []
  const seen = new Set<string>()
  let complete = true
  for (const entry of value) {
    const group = parseVrcGroup(entry, selfId)
    if (!group) {
      complete = false
      continue
    }
    if (seen.has(group.groupId)) continue
    seen.add(group.groupId)
    if (items.length >= max) {
      complete = false
      break
    }
    items.push(group)
  }
  return { items, complete }
}

/** `GET /visits` answers with a bare number: everyone online on VRChat now. */
export function parseVrcPlayersOnline(value: unknown): number | null {
  return count(value)
}
